import { BrowserRouter, Navigate, NavLink, Route, Routes } from 'react-router'
import { CustomerFormPage } from './pages/CustomerFormPage'
import { CustomerPage } from './pages/CustomerPage'
import { CustomersPage } from './pages/CustomersPage'
import { MortgagePage } from './pages/MortgagePage'
import { MortgagesPage } from './pages/MortgagesPage'
import { NewMortgagePage } from './pages/NewMortgagePage'
import { ReferrerPage } from './pages/ReferrerPage'
import { SettingsPage } from './pages/SettingsPage'

export default function App() {
  return (
    <BrowserRouter>
      <div className="layout">
        <header>
          <h1>Mortgage Management</h1>
          <nav>
            <NavLink to="/customers">Customers</NavLink>
            <NavLink to="/mortgages">Mortgages</NavLink>
            <NavLink to="/settings">Settings</NavLink>
          </nav>
        </header>
        <main>
          <Routes>
            <Route path="/" element={<Navigate to="/customers" replace />} />
            <Route path="/customers" element={<CustomersPage />} />
            <Route path="/customers/new" element={<CustomerFormPage />} />
            <Route path="/customers/:id" element={<CustomerPage />} />
            <Route path="/customers/:id/edit" element={<CustomerFormPage />} />
            <Route path="/mortgages" element={<MortgagesPage />} />
            <Route path="/mortgages/new" element={<NewMortgagePage />} />
            <Route path="/mortgages/:id" element={<MortgagePage />} />
            <Route path="/referrers/:id" element={<ReferrerPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
