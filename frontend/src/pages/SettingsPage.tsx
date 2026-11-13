import { BackupSettings } from './settings/BackupSettings'
import { CallListThresholds } from './settings/CallListThresholds'
import { DefaultTermsSettings } from './settings/DefaultTermsSettings'
import { GoldRateSettings } from './settings/GoldRateSettings'
import {
  CashLimitSettings,
  DiscountConfirmationSettings,
  GracePeriodSettings,
} from './settings/LimitSettings'
import { MessageSettingsForm } from './settings/MessageSettings'

export function SettingsPage() {
  return (
    <>
      <DefaultTermsSettings />
      <GoldRateSettings />
      <CallListThresholds />
      <CashLimitSettings />
      <DiscountConfirmationSettings />
      <GracePeriodSettings />
      <MessageSettingsForm />
      <BackupSettings />
    </>
  )
}
