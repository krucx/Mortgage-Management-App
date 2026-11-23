import { BrowserRouter, Route, Routes } from 'react-router'
import { UnknownIdBoundary } from './components/UnknownIdBoundary'
import { StartGate } from './components/StartGate'
import { TopBar } from './components/TopBar'
import { UpdateBanner } from './components/UpdateBanner'
import { CalculatorPage } from './pages/CalculatorPage'
import { CallListPage } from './pages/CallListPage'
import { ChangeTermsPage } from './pages/ChangeTermsPage'
import { ClosuresPage } from './pages/ClosuresPage'
import { CustomerFormPage } from './pages/CustomerFormPage'
import { CustomerPage } from './pages/CustomerPage'
import { CustomersPage } from './pages/CustomersPage'
import { DashboardPage } from './pages/DashboardPage'
import { EditMortgagePage } from './pages/EditMortgagePage'
import { MortgagePage } from './pages/MortgagePage'
import { MortgagesPage } from './pages/MortgagesPage'
import { NewMortgagePage } from './pages/NewMortgagePage'
import { NewPaymentPage } from './pages/NewPaymentPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { RemindersPage } from './pages/RemindersPage'
import { PaymentPage } from './pages/PaymentPage'
import { PaymentsPage } from './pages/PaymentsPage'
import { RedeemPage } from './pages/RedeemPage'
import { ReceiptPage } from './pages/ReceiptPage'
import { ReferrerPage } from './pages/ReferrerPage'
import { SettingsPage } from './pages/SettingsPage'

export default function App() {
  return (
    <StartGate>
      <BrowserRouter>
        <div className="layout">
          <TopBar />
          <UpdateBanner />
          <main>
            <AppRoutes />
          </main>
        </div>
      </BrowserRouter>
    </StartGate>
  )
}

/** Each page at its address; anywhere else, Page not found. */
export function AppRoutes() {
  return (
    <UnknownIdBoundary>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/payments" element={<PaymentsPage />} />
        <Route path="/payments/new" element={<NewPaymentPage />} />
        <Route path="/payments/:id" element={<PaymentPage />} />
        <Route path="/payments/:id/receipt" element={<ReceiptPage />} />
        <Route
          path="/payments/:id/advance-instalments/:instalment/receipt"
          element={<ReceiptPage />}
        />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/customers/new" element={<CustomerFormPage />} />
        <Route path="/customers/:id" element={<CustomerPage />} />
        <Route path="/customers/:id/edit" element={<CustomerFormPage />} />
        <Route path="/mortgages" element={<MortgagesPage />} />
        <Route path="/mortgages/new" element={<NewMortgagePage />} />
        <Route path="/mortgages/:id" element={<MortgagePage />} />
        <Route path="/mortgages/:id/redeem" element={<RedeemPage />} />
        <Route path="/mortgages/:id/edit" element={<EditMortgagePage />} />
        <Route path="/mortgages/:id/terms" element={<ChangeTermsPage />} />
        <Route path="/calculator" element={<CalculatorPage />} />
        <Route path="/call-list" element={<CallListPage />} />
        <Route path="/reminders" element={<RemindersPage />} />
        <Route path="/closures" element={<ClosuresPage />} />
        <Route path="/referrers/:id" element={<ReferrerPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </UnknownIdBoundary>
  )
}
