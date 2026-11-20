@echo off
rem Starts the site locally AND exposes it through a temporary Cloudflare quick
rem tunnel, so a remote tester can open a public https address.
call "%~dp0START-WEBSITE.bat" public
