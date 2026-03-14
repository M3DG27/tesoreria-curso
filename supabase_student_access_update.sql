alter table public.students
add column if not exists email text;

create unique index if not exists students_email_unique_idx
on public.students (lower(email))
where email is not null;

drop policy if exists "students public read" on public.students;
drop policy if exists "students own read" on public.students;
create policy "students own read"
on public.students for select
to authenticated
using (
    (select public.is_treasurer())
    or lower(coalesce(email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
);

drop policy if exists "fees public read" on public.fees;
drop policy if exists "fees own read" on public.fees;
create policy "fees own read"
on public.fees for select
to authenticated
using (
    (select public.is_treasurer())
    or exists (
        select 1
        from public.students s
        where s.id = fees.student_id
        and lower(coalesce(s.email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
);

drop policy if exists "payments public read" on public.payments;
drop policy if exists "payments own read" on public.payments;
create policy "payments own read"
on public.payments for select
to authenticated
using (
    (select public.is_treasurer())
    or exists (
        select 1
        from public.fees f
        join public.students s on s.id = f.student_id
        where f.id = payments.fee_id
        and lower(coalesce(s.email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
);

drop policy if exists "expenses public read" on public.expenses;
drop policy if exists "expenses authenticated read" on public.expenses;
drop policy if exists "expenses treasurer read" on public.expenses;
create policy "expenses authenticated read"
on public.expenses for select
to authenticated
using (true);
