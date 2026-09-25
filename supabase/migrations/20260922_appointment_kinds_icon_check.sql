do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'appointment_kinds_icon_check'
      and conrelid = 'public.appointment_kinds'::regclass
  ) then
    alter table public.appointment_kinds
      add constraint appointment_kinds_icon_check
      check (icon in (
        'medkit-outline',
        'school-outline',
        'briefcase-outline',
        'person-outline',
        'call-outline',
        'chatbubble-ellipses-outline',
        'car-outline',
        'home-outline',
        'cart-outline',
        'restaurant-outline',
        'fitness-outline',
        'gift-outline',
        'calendar-outline',
        'ellipsis-horizontal-outline'
      )) not valid;
  end if;
end;
$$;

update public.appointment_kinds
set icon = 'ellipsis-horizontal-outline'
where icon not in (
  'medkit-outline',
  'school-outline',
  'briefcase-outline',
  'person-outline',
  'call-outline',
  'chatbubble-ellipses-outline',
  'car-outline',
  'home-outline',
  'cart-outline',
  'restaurant-outline',
  'fitness-outline',
  'gift-outline',
  'calendar-outline',
  'ellipsis-horizontal-outline'
);

alter table public.appointment_kinds
  validate constraint appointment_kinds_icon_check;
