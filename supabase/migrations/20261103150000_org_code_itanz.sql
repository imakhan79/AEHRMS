-- Rebrand follow-up: the client organisation code becomes ITANZ (was AEG).
update public.organizations set code = 'ITANZ' where code = 'AEG';
