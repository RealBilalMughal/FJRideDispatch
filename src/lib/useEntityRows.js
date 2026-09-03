import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from './supabase'
import { useCity } from '../context/useCity'

/**
 * Shared list loader for the city-scoped fleet pages. Fetches `table` ordered by
 * `ref_no` desc, scoped to the current city filter. RLS is the real boundary;
 * the `.eq('city_id', ...)` is just the convenience filter.
 */
export function useEntityRows({ table, select, canView, label }) {
  const { cityId, cityName, ready } = useCity()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  const fetchRows = useCallback(async () => {
    setLoading(true)
    let q = supabase.from(table).select(select).order('ref_no', { ascending: false })
    if (cityId != null) q = q.eq('city_id', cityId)
    const { data, error } = await q
    if (error) toast.error(`Could not load ${label || table}`)
    setRows(data ?? [])
    setLoading(false)
  }, [table, select, cityId, label])

  useEffect(() => {
    if (canView && ready) fetchRows()
  }, [canView, ready, fetchRows])

  return { rows, setRows, loading, fetchRows, cityId, cityName }
}
