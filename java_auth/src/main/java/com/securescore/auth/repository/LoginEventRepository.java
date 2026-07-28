package com.securescore.auth.repository;

import com.securescore.auth.domain.LoginEvent;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface LoginEventRepository extends JpaRepository<LoginEvent, UUID> {}
