import { DORMANT_SORTS, MORTGAGE_SORTS } from '../../api'
import { useListPage } from '../../components/useListPage'
import { lists } from '../../requests'

/** Dormant Mortgages (owing nothing), sorted and paged on the server. */
export const useDormantList = () =>
  useListPage(DORMANT_SORTS, lists.dormant(), { sortParam: 'dormant_sort' })

/** Active Mortgages still owing something: the ones that can be Forfeited or Waived off. */
export const useForfeitableList = () =>
  useListPage(MORTGAGE_SORTS, lists.mortgages({ status: 'active', owing: true }), {
    sortParam: 'forfeit_sort',
  })
