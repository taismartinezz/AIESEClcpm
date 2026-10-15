Feature: Settings page

  Scenario: Settings page loads
    Given I am logged in
    When I navigate to /settings
    Then the page should load without errors
    And I should see a profile section

  Scenario: The president sees the invite section
    Given I am logged in as the LC president
    When I navigate to /settings
    Then I should see the LC invite section

  Scenario: A member does not see the invite section
    Given I am logged in as a member
    When I navigate to /settings
    Then I should not see an invite code section
