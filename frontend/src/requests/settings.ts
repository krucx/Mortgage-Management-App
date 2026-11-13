import { queryOptions } from '@tanstack/react-query'
import type { CallListSettings, MessageSettings, Purity, Terms } from '../api'
import { dataOrThrow, keys, type ApiClient } from '../serverState'

/** A settings group: read once, then known from what saving it returns. */
function settingsQuery<T>(name: string, load: () => Promise<T>) {
  return queryOptions({ queryKey: [...keys.settings, name], queryFn: load, staleTime: Infinity })
}

/** Each settings group, and saving it. */
export const settings = {
  defaultTerms: (client: ApiClient) =>
    settingsQuery('default-terms', () => dataOrThrow(client.GET('/api/settings/default-terms'))),
  saveDefaultTerms: (client: ApiClient, terms: Terms) =>
    dataOrThrow(client.PUT('/api/settings/default-terms', { body: terms })),
  goldRates: (client: ApiClient) =>
    settingsQuery('gold-rates', () => dataOrThrow(client.GET('/api/settings/gold-rates'))),
  saveGoldRates: (client: ApiClient, rates: { purity_karat: Purity; rate_per_gram: number }[]) =>
    dataOrThrow(client.PUT('/api/settings/gold-rates', { body: rates })),
  callList: (client: ApiClient) =>
    settingsQuery('call-list', () => dataOrThrow(client.GET('/api/settings/call-list'))),
  saveCallList: (client: ApiClient, thresholds: CallListSettings) =>
    dataOrThrow(client.PUT('/api/settings/call-list', { body: thresholds })),
  cashLimit: (client: ApiClient) =>
    settingsQuery('cash-limit', () => dataOrThrow(client.GET('/api/settings/cash-limit'))),
  saveCashLimit: (client: ApiClient, cashLimit: number | null) =>
    dataOrThrow(client.PUT('/api/settings/cash-limit', { body: { cash_limit: cashLimit } })),
  discountConfirmationLimit: (client: ApiClient) =>
    settingsQuery('discount-confirmation-limit', () =>
      dataOrThrow(client.GET('/api/settings/discount-confirmation-limit')),
    ),
  saveDiscountConfirmationLimit: (client: ApiClient, limit: number | null) =>
    dataOrThrow(
      client.PUT('/api/settings/discount-confirmation-limit', {
        body: { discount_confirmation_limit: limit },
      }),
    ),
  gracePeriod: (client: ApiClient) =>
    settingsQuery('grace-period', () => dataOrThrow(client.GET('/api/settings/grace-period'))),
  saveGracePeriod: (client: ApiClient, days: number | null) =>
    dataOrThrow(client.PUT('/api/settings/grace-period', { body: { grace_period_days: days } })),
  messages: (client: ApiClient) =>
    settingsQuery('messages', () => dataOrThrow(client.GET('/api/settings/messages'))),
  saveMessages: (client: ApiClient, messages: MessageSettings) =>
    dataOrThrow(client.PUT('/api/settings/messages', { body: messages })),
  placeholders: (client: ApiClient) =>
    settingsQuery('placeholders', () =>
      dataOrThrow(client.GET('/api/settings/messages/placeholders')),
    ),
  saveBackups: (client: ApiClient, keep: number) =>
    dataOrThrow(client.PUT('/api/settings/backups', { body: { keep } })),
}

/** The Backups: when the last was taken, whether one is running, how many are kept. */
export function backupsQuery(client: ApiClient) {
  return queryOptions({
    queryKey: keys.backups,
    queryFn: () => dataOrThrow(client.GET('/api/backups')),
    // While a Backup runs in the background, check on it every second.
    refetchInterval: (query) => (query.state.data?.running ? 1000 : false),
  })
}

export const backUpNow = (client: ApiClient) => dataOrThrow(client.POST('/api/backups'))
