import { dataOrThrow, type ApiClient } from '../serverState'
import { mortgagePath, reminderPath } from './paths'
import { fileForm } from './files'

/** What the Lender does with a queued Reminder. */
export const reminderActions = {
  approve: (client: ApiClient, id: number) =>
    dataOrThrow(client.POST('/api/reminders/{reminder_id}/approve', { params: reminderPath(id) })),
  skip: (client: ApiClient, id: number) =>
    dataOrThrow(client.POST('/api/reminders/{reminder_id}/skip', { params: reminderPath(id) })),
  markSent: (client: ApiClient, id: number) =>
    dataOrThrow(client.POST('/api/reminders/{reminder_id}/sent', { params: reminderPath(id) })),
}

/** Note that the Customer was phoned about a Mortgage today. */
export const addCallNote = (client: ApiClient, mortgageId: number, note: string) =>
  dataOrThrow(
    client.POST('/api/mortgages/{mortgage_id}/call-notes', {
      params: mortgagePath(mortgageId),
      body: { note },
    }),
  )

/** The Call Sheet: where to download it, and importing the Excel sheet back with the
 *  Call Notes written in (previewed first; all of them or none). */
export const callSheet = {
  exportUrl: (kind: 'xlsx' | 'pdf') => `/api/call-list/export.${kind}`,
  previewImport: (client: ApiClient, sheet: File) =>
    importSheet(client, sheet, '/api/call-list/import-preview'),
  import: (client: ApiClient, sheet: File) => importSheet(client, sheet, '/api/call-list/import'),
}

function importSheet(
  client: ApiClient,
  sheet: File,
  path: '/api/call-list/import-preview' | '/api/call-list/import',
) {
  return dataOrThrow(
    client.POST(path, {
      // The schema types the file as a string; it is sent as multipart form data.
      body: { file: '' },
      bodySerializer: () => fileForm('file', sheet, sheet.name),
    }),
  )
}
