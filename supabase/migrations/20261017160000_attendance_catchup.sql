-- Nightly close now re-checks the last 7 days, so a missed cron run (or late punches,
-- verifications and corrections) can't leave days without an attendance row.
select cron.schedule(
  'attendance-close-yesterday',
  '30 19 * * *',
  $$select private.mark_daily_attendance(d::date)
      from generate_series((now() at time zone 'Asia/Karachi')::date - 7, (now() at time zone 'Asia/Karachi')::date - 1, interval '1 day') d$$
);

-- One-off backfill of the current month (earlier months are already closed by payroll).
select private.mark_daily_attendance(d::date)
  from generate_series(date_trunc('month', (now() at time zone 'Asia/Karachi')::date)::date,
                       (now() at time zone 'Asia/Karachi')::date - 1, interval '1 day') d;
