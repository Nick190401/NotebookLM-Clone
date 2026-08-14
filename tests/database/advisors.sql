do $$
begin
  if exists (
    select 1
    from pg_constraint constraint_row
    join pg_attribute attribute_row
      on attribute_row.attrelid = constraint_row.conrelid
      and attribute_row.attnum = any(constraint_row.conkey)
    where constraint_row.contype = 'f'
      and constraint_row.connamespace = 'public'::regnamespace
      and not exists (
        select 1 from pg_index index_row
        where index_row.indrelid = constraint_row.conrelid
          and attribute_row.attnum = any(index_row.indkey)
      )
  ) then raise exception 'A public foreign key column has no supporting index'; end if;
  if exists (
    select 1 from pg_class
    where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity
  ) then raise exception 'A public table does not have RLS enabled'; end if;
  if exists (
    select 1 from pg_proc where pronamespace = 'public'::regnamespace and prosecdef
  ) then raise exception 'A public function unexpectedly uses SECURITY DEFINER'; end if;
end;
$$;
