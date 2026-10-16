import { SettingsPage } from './pages/SettingsPage'

export default function App() {
  return (
    <div className="layout">
      <header>
        <h1>Mortgage Management</h1>
        <nav>
          <a className="active" href="/">
            Settings
          </a>
        </nav>
      </header>
      <main>
        <SettingsPage />
      </main>
    </div>
  )
}
