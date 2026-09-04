import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { CityContext } from './city-context'

const STORAGE_KEY = 'fj.city'

/**
 * The global "which city am I looking at" filter, shared by every list page.
 *
 * Cities the user may see:
 *   - super_admin                 -> every city
 *   - has user_cities rows        -> only those
 *   - else any role_cities rows   -> the union across their roles
 *   - else (nothing configured)   -> every city
 *
 * If the user can see exactly one city the filter is LOCKED to it (no "All").
 * `cityId` is null when "All" is selected, otherwise the numeric city id -
 * list pages add `.eq('city_id', cityId)` when it is set. RLS is still the hard
 * boundary; this is the convenience filter within the allowed set.
 */
export function CityProvider({ children }) {
  const { session, roles, isSuperAdmin, loading: authLoading } = useAuth()

  const [allCities, setAllCities] = useState([])
  const [allowedIds, setAllowedIds] = useState(null) // null = unrestricted
  const [ready, setReady] = useState(false)
  const [selected, setSelected] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || 'all'
    } catch {
      return 'all'
    }
  })

  useEffect(() => {
    if (authLoading) return
    if (!session) {
      setAllCities([])
      setAllowedIds(null)
      setReady(false)
      return
    }
    let active = true
    ;(async () => {
      const { data: cs } = await supabase
        .from('cities')
        .select('id, name, sort, airport_name, airport_lat, airport_lng')
        .order('sort')
        .order('name')
      if (!active) return
      setAllCities(cs ?? [])

      if (isSuperAdmin) {
        setAllowedIds(null)
        setReady(true)
        return
      }

      const [{ data: uc }, rc] = await Promise.all([
        supabase.from('user_cities').select('city_id').eq('user_id', session.user.id),
        roles.length
          ? supabase.from('role_cities').select('city_id').in('role', roles)
          : Promise.resolve({ data: [] }),
      ])
      if (!active) return
      if (uc && uc.length) setAllowedIds([...new Set(uc.map((r) => r.city_id))])
      else if (rc.data && rc.data.length) setAllowedIds([...new Set(rc.data.map((r) => r.city_id))])
      else setAllowedIds(null)
      setReady(true)
    })()
    return () => {
      active = false
    }
  }, [session, roles, isSuperAdmin, authLoading])

  const allowedCities = useMemo(
    () => (allowedIds === null ? allCities : allCities.filter((c) => allowedIds.includes(c.id))),
    [allCities, allowedIds],
  )

  const locked = allowedCities.length <= 1

  // keep the selection valid for what the user can actually see
  const effective = useMemo(() => {
    if (locked) return allowedCities[0] ? String(allowedCities[0].id) : 'all'
    if (selected !== 'all' && !allowedCities.some((c) => String(c.id) === String(selected))) {
      return 'all'
    }
    return selected
  }, [locked, allowedCities, selected])

  const setCity = useCallback((value) => {
    const v = String(value)
    setSelected(v)
    try {
      localStorage.setItem(STORAGE_KEY, v)
    } catch {
      /* ignore */
    }
  }, [])

  const cityId = effective === 'all' ? null : Number(effective)
  const cityName =
    effective === 'all' ? 'All cities' : allCities.find((c) => c.id === cityId)?.name || ''

  const value = useMemo(
    () => ({
      ready,
      allCities,
      allowedCities,
      locked,
      city: effective, // 'all' | '<id>'
      cityId, // null | number
      cityName,
      setCity,
      /** apply the current filter to a supabase query builder */
      scope: (query) => (cityId == null ? query : query.eq('city_id', cityId)),
    }),
    [ready, allCities, allowedCities, locked, effective, cityId, cityName, setCity],
  )

  return <CityContext.Provider value={value}>{children}</CityContext.Provider>
}
