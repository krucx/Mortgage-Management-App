Feature: Update banner
  When a newer release is out, a banner says so, with what's new in it. Later puts it off
  for that version on this laptop; a still newer release shows it again. The scenarios
  stub the app's answer to /api/update, so no release has to exist.

  @golden @screen:/
  Scenario: A newer release is offered with its notes, and Later puts it off for that version
    Given today is 15 Nov 2025
    And version "99.0.0" is released with the notes "- A quicker Dashboard"
    When the Lender opens the Dashboard
    Then the update banner says "Version 99.0.0 is available"
    When the Lender opens What's new in the banner
    Then the banner's notes list "A quicker Dashboard"
    When the Lender chooses Later
    Then no update banner is shown
    When the Lender reloads the page
    Then no update banner is shown
    When the Lender opens the Customers list
    Then no update banner is shown

  @golden @screen:/
  Scenario: A release newer than the one put off shows the banner again
    Given today is 15 Nov 2025
    And version "99.0.0" is released with the notes "- A quicker Dashboard"
    When the Lender opens the Dashboard
    And the Lender chooses Later
    And version "99.1.0" is released after that, with the notes "- A calmer Calculator"
    And the Lender reloads the page
    Then the update banner says "Version 99.1.0 is available"

  @golden @screen:/
  Scenario: No banner when the running version is the newest
    Given today is 15 Nov 2025
    And no newer release is out
    When the Lender opens the Dashboard
    Then no update banner is shown
