package main

import (
	"fmt"
	htmlpkg "html"
	"log"
	"net/mail"
	"net/smtp"
	"strings"
)

// validEmail reports whether addr is a parseable single address. net/mail is
// stricter and more correct than a hand-rolled regex, and it is stdlib.
func validEmail(addr string) bool {
	if addr == "" {
		return false
	}
	parsed, err := mail.ParseAddress(addr)
	return err == nil && parsed.Address == addr
}

// smtpConfigured reports whether enough SMTP config exists to attempt a send.
// Sending is optional: with SMTP_HOST unset the BFF runs exactly as before.
func smtpConfigured() bool {
	return getEnv("SMTP_HOST", "") != "" && getEnv("SMTP_FROM", "") != ""
}

// sendMailHTML delivers a multipart/alternative message: clients that render
// HTML show htmlBody, the rest fall back to textBody. Blocking — call it in a
// goroutine from request paths.
func sendMailHTML(to, subject, textBody, htmlBody string) error {
	// Fixed boundary is fine: it only has to be absent from the parts, and both
	// are ours. Random would buy nothing here.
	const boundary = "securescore-alt-boundary-8f2a1c"
	body := "--" + boundary + "\r\n" +
		"Content-Type: text/plain; charset=UTF-8\r\n\r\n" +
		textBody + "\r\n\r\n" +
		"--" + boundary + "\r\n" +
		"Content-Type: text/html; charset=UTF-8\r\n\r\n" +
		htmlBody + "\r\n\r\n" +
		"--" + boundary + "--\r\n"
	return sendMailRaw(to, subject,
		"multipart/alternative; boundary=\""+boundary+"\"", body)
}

// sendMail delivers one plain-text message. Blocking — call it in a goroutine
// from request paths. Returns an error rather than logging so callers decide.
func sendMail(to, subject, body string) error {
	return sendMailRaw(to, subject, "text/plain; charset=UTF-8", body)
}

// sendMailRaw is the shared SMTP path: contentType becomes the Content-Type
// header and body is sent verbatim after the headers.
func sendMailRaw(to, subject, contentType, body string) error {
	host := getEnv("SMTP_HOST", "")
	port := getEnv("SMTP_PORT", "587")
	user := getEnv("SMTP_USER", "")
	pass := getEnv("SMTP_PASS", "")
	from := getEnv("SMTP_FROM", "")

	if host == "" || from == "" {
		return fmt.Errorf("smtp not configured")
	}
	if !validEmail(to) {
		return fmt.Errorf("invalid recipient %q", to)
	}
	// CRLF in a header field would let a caller inject extra headers.
	if strings.ContainsAny(subject, "\r\n") {
		return fmt.Errorf("subject contains newline")
	}

	msg := "From: " + from + "\r\n" +
		"To: " + to + "\r\n" +
		"Subject: " + subject + "\r\n" +
		"MIME-Version: 1.0\r\n" +
		"Content-Type: " + contentType + "\r\n" +
		"\r\n" + body + "\r\n"

	var auth smtp.Auth
	if user != "" {
		// PlainAuth refuses to send credentials over an unencrypted link, so on
		// :587 this only proceeds once STARTTLS has been negotiated.
		auth = smtp.PlainAuth("", user, pass, host)
	}
	return smtp.SendMail(host+":"+port, auth, from, []string{to}, []byte(msg))
}

// sendWelcomeEmail notifies a newly created user, in the background so a slow or
// dead SMTP server cannot stall or fail account creation.
//
// Deliberately omits the password: mail is unencrypted in transit and there is
// no forced-reset-on-first-login flow, so staff hand credentials over directly.
func sendWelcomeEmail(to, fullName, username string) {
	if !smtpConfigured() || !validEmail(to) {
		return
	}
	name := fullName
	if name == "" {
		name = username
	}
	text := fmt.Sprintf(
		"Dear %s,\n\n"+
			"Your SecureScore account has been created by your branch.\n\n"+
			"Username: %s\n\n"+
			"Your branch staff will provide your password directly. We will never\n"+
			"email you a password or ask you to send one back.\n\n"+
			"— SecureScore",
		name, username)

	html := welcomeHTML(name, username)

	go func() {
		if err := sendMailHTML(to, "Your SecureScore account is ready", text, html); err != nil {
			log.Printf("[MAIL] welcome email to %s failed: %v", to, err)
			return
		}
		log.Printf("[MAIL] welcome email sent to %s", to)
	}()
}

// welcomeHTML renders the account-created email. Table layout and inline styles
// on purpose: Outlook ignores flex/grid and stripped <style> blocks.
//
// Escapes its own inputs: both are staff-supplied, and a full name containing
// markup would otherwise rewrite the email body.
func welcomeHTML(rawName, rawUsername string) string {
	name := htmlpkg.EscapeString(rawName)
	username := htmlpkg.EscapeString(rawUsername)
	return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f5f7;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <tr>
          <td style="background:#0f766e;padding:24px 32px;">
            <div style="color:#ffffff;font-size:18px;font-weight:600;letter-spacing:0.2px;">SecureScore</div>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 16px;font-size:16px;color:#111827;">Dear ` + name + `,</p>
            <p style="margin:0 0 24px;font-size:14px;line-height:22px;color:#374151;">
              Your account has been created by your branch. You can sign in once staff
              provide your password.
            </p>
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;margin:0 0 24px;">
              <tr><td style="padding:16px 20px;">
                <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.6px;color:#6b7280;margin-bottom:6px;">Username</div>
                <div style="font-size:16px;font-weight:600;color:#111827;font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;">` + username + `</div>
              </td></tr>
            </table>
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#fffbeb;border-left:3px solid #f59e0b;border-radius:4px;">
              <tr><td style="padding:12px 16px;">
                <div style="font-size:13px;line-height:20px;color:#78350f;">
                  We will never email you a password, or ask you to send one back.
                  Your branch will hand over your credentials directly.
                </div>
              </td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px;border-top:1px solid #e5e7eb;">
            <div style="font-size:12px;color:#9ca3af;">This is an automated message from SecureScore.</div>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}
