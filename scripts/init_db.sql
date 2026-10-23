CREATE DATABASE ecp CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE ecp_shadow CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'ecp_user'@'localhost' IDENTIFIED BY 'password';
GRANT ALL PRIVILEGES ON ecp.* TO 'ecp_user'@'localhost';
GRANT ALL PRIVILEGES ON ecp_shadow.* TO 'ecp_user'@'localhost';