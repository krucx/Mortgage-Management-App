@golden
Feature: Page width
  Screens fit the desktop width (1280px) without scrolling sideways. There is no
  phone-width run yet.

  Scenario Outline: <screen> fits the page width
    Given today is 15 Nov 2025
    When the Lender opens <screen>
    Then the page fits its width

    @screen:/
    Examples: Dashboard
      | screen        |
      | the Dashboard |

    @screen:/customers
    Examples: Customers
      | screen             |
      | the Customers list |

    @screen:/mortgages/:id
    Examples: A Mortgage with an Advance
      | screen               |
      | 2025-Ramesh-GoldRing |

    @screen:/payments/:id
    Examples: A Payment
      | screen                           |
      | the Payment "UPI advance Ramesh" |

    @screen:/payments/new
    Examples: The payment form
      | screen                            |
      | a new Payment from "Ramesh Kumar" |

    @screen:/payments
    Examples: The Payments list
      | screen                |
      | the Payments list     |

    @screen:/mortgages
    Examples: The Mortgages list
      | screen              |
      | the Mortgages list  |

    @screen:/calculator
    Examples: The Calculator
      | screen          |
      | the Calculator  |

    @screen:/call-list
    Examples: The Call List
      | screen        |
      | the Call List |

    @screen:/reminders
    Examples: The Reminders page
      | screen                                 |
      | the Reminders page on 15 Nov 2025      |

    @screen:/closures
    Examples: The Closures page
      | screen             |
      | the Closures page  |

    @screen:/settings
    Examples: Settings
      | screen   |
      | Settings |
