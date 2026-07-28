FROM eclipse-temurin:21-jdk-alpine AS builder
RUN apk add --no-cache maven
WORKDIR /build
COPY pom.xml .
RUN mvn -q dependency:go-offline -B
COPY src ./src
RUN mvn -q clean package -DskipTests -B

FROM eclipse-temurin:21-jre-alpine
RUN addgroup -S gateway && adduser -S gateway -G gateway
WORKDIR /app
COPY --from=builder /build/target/gateway-*.jar app.jar
RUN chown gateway:gateway app.jar
USER gateway
EXPOSE 4000
ENTRYPOINT ["java", "-XX:+UseContainerSupport", "-XX:MaxRAMPercentage=75.0", "-jar", "app.jar"]
