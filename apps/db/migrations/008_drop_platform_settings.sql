-- Credentials live in .env, not in a table. The settings screen that wrote here is gone;
-- keeping the row would be a secret store nobody reads and a surface area for leaks.
DROP TABLE IF EXISTS platform_settings;