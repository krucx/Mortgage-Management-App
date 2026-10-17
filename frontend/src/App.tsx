import { BrowserRouter, Navigate, NavLink, Route, Routes } from 'react-router'
import { useReadyToRedeemCount } from './components/useReadyToRedeem'
import { ClosuresPage } from './pages/ClosuresPage'
import { CustomerFormPage } from './pages/CustomerFormPage'
import { CustomerPage } from './pages/CustomerPage'
import { CustomersPage } from './pages/CustomersPage'
import { MortgagePage } from './pages/MortgagePage'
import { MortgagesPage } from './pages/MortgagesPage'
import { NewMortgagePage } from './pages/NewMortgagePage'
import { NewPaymentPage } from './pages/NewPaymentPage'
import { PaymentPage } from './pages/PaymentPage'
import { PaymentsPage } from './pages/PaymentsPage'
import { RedeemPage } from './pages/RedeemPage'
import { ReferrerPage } from './pages/ReferrerPage'
import { SettingsPage } from './pages/SettingsPage'

function Nav() {
  const waiting = useReadyToRedeemCount()
  return (
    <nav>
      <NavLink to="/payments">Payments</NavLink>
      <NavLink to="/customers">Customers</NavLink>
      <NavLink to="/mortgages">Mortgages</NavLink>
      <NavLink
        to="/closures"
        title={waiting ? `${waiting} paid off, waiting to be Redeemed` : undefined}
      >
        Redeem / Forfeit
        {waiting > 0 && <span className="dot" aria-label={`${waiting} waiting to be Redeemed`} />}
      </NavLink>
      <NavLink to="/settings">Settings</NavLink>
    </nav>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="layout">
        <header>
          <h1>Mortgage Management</h1>
          <Nav />
        </header>
        <main>
          <Routes>
            <Route path="/" element={<Navigate to="/payments" replace />} />
            <Route path="/payments" element={<PaymentsPage />} />
            <Route path="/payments/new" element={<NewPaymentPage />} />
            <Route path="/payments/:id" element={<PaymentPage />} />
            <Route path="/customers" element={<CustomersPage />} />
            <Route path="/customers/new" element={<CustomerFormPage />} />
            <Route path="/customers/:id" element={<CustomerPage />} />
            <Route path="/customers/:id/edit" element={<CustomerFormPage />} />
            <Route path="/mortgages" element={<MortgagesPage />} />
            <Route path="/mortgages/new" element={<NewMortgagePage />} />
            <Route path="/mortgages/:id" element={<MortgagePage />} />
            <Route path="/mortgages/:id/redeem" element={<RedeemPage />} />
            <Route path="/closures" element={<ClosuresPage />} />
            <Route path="/referrers/:id" element={<ReferrerPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
