-- =====================================================================
-- Rebrand: the client organisation is now iTANZ (was AE Global Group of
-- Companies). The org code 'AEG' is an internal identifier and is kept.
-- =====================================================================

update public.organizations
set name = 'iTANZ'
where code = 'AEG' and name = 'AE Global Group of Companies';

alter table public.system_settings alter column company_name set default 'iTANZ';

-- Only replace the old default; leave a name an admin has already edited.
update public.system_settings
set company_name = 'iTANZ'
where company_name = 'AE Global Group of Companies';
