Feature: Navigation
  The header names the app and its version, links to every page, and holds the theme switch.
  An address the app has no page for shows the header and a Page not found screen: the
  screen already exists, so there is no product change to decide.

  @golden
  Rule: The header links to every page and marks the one the Lender is on

    Scenario Outline: The <link> link opens its page and is the one highlighted
      Given today is 15 Nov 2025
      When the Lender opens the address "/no-such-page"
      Then no link in the header is highlighted
      When the Lender follows the "<link>" link in the header
      Then the Lender is on "<path>"
      And only the "<link>" link in the header is highlighted

      @screen:/
      Examples: Dashboard
        | link      | path |
        | Dashboard | /    |

      @screen:/payments
      Examples: Payments
        | link     | path      |
        | Payments | /payments |

      @screen:/customers
      Examples: Customers
        | link      | path       |
        | Customers | /customers |

      @screen:/mortgages
      Examples: Mortgages
        | link      | path       |
        | Mortgages | /mortgages |

      @screen:/calculator
      Examples: Calculator
        | link       | path        |
        | Calculator | /calculator |

      @screen:/call-list
      Examples: Call List
        | link      | path       |
        | Call List | /call-list |

      @screen:/reminders
      Examples: Reminders
        | link      | path       |
        | Reminders | /reminders |

      @screen:/closures
      Examples: Closures
        | link     | path      |
        | Closures | /closures |

      @screen:/settings
      Examples: Settings
        | link     | path      |
        | Settings | /settings |

    @screen:/
    Scenario: The title links to the Dashboard and names the version running
      Given today is 15 Nov 2025
      When the Lender opens the Customers list
      Then the header names the version the app is running
      When the Lender follows the title in the header
      Then the Lender is on "/"

  Rule: The theme switch is kept across reloads

    @golden @screen:/
    Scenario: A theme the Lender chose is shown again after a reload, until it is switched back
      Given today is 15 Nov 2025
      When the Lender opens the Dashboard
      Then the header offers to switch to the dark theme
      When the Lender switches the theme
      Then the dark theme is shown
      And the header offers to switch to the light theme
      When the Lender reloads the page
      Then the dark theme is shown
      When the Lender switches the theme
      And the Lender reloads the page
      Then the header offers to switch to the dark theme
      And no theme is chosen

  Rule: An address with no page shows the header and Page not found

    @golden @screen:*
    Scenario: An unknown address
      Given today is 15 Nov 2025
      When the Lender opens the address "/no-such-page?from=a-link"
      Then the header links to every page
      And the page says "Page not found" and that nothing was found at "/no-such-page?from=a-link"
      When the Lender follows "Customers" from the page
      Then the Lender is on "/customers"
