import { Link } from 'react-router'
import { APP_VERSION } from '../version'
import { Nav } from './Nav'
import { ThemeToggle } from './ThemeToggle'
import styles from './TopBar.module.css'

/** The bar across the top of every page: the app's name and version, its pages, the theme switch. */
export function TopBar() {
  return (
    <header className={styles.bar}>
      <h1 className={styles.title}>
        <Link to="/">Mortgage Management</Link>
        <sup className={styles.version} title={`Version ${APP_VERSION}`}>
          v{APP_VERSION}
        </sup>
      </h1>
      <Nav />
      <ThemeToggle />
    </header>
  )
}
