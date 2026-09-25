-- Helper RPC: shift ride_plan_rows seqs for a given plan_date+city_id
-- Used when inserting new rows mid-table (UserPlus crew dispatch).
-- Runs as security invoker so the caller's RLS policies still apply.
create or replace function public.shift_plan_row_seqs(
  p_plan_date date,
  p_city_id   uuid,
  p_after_seq int,
  p_increment int
) returns void language plpgsql security invoker as $$
begin
  update public.ride_plan_rows
  set    seq = seq + p_increment
  where  plan_date = p_plan_date
    and  city_id   = p_city_id
    and  seq       > p_after_seq;
end;
$$;

grant execute on function public.shift_plan_row_seqs(date, uuid, int, int) to authenticated;
