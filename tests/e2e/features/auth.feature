Feature: Authentication page

  Scenario: Login page has accessible heading
    Given I am on the login page
    Then the page should have an h1 heading

  Scenario: Sign up link is a real anchor tag
    Given I am on the login page
    When I look at the sign up toggle
    Then it should be an anchor element with a valid href

  Scenario: Privacy policy link is clickable
    Given I am on the login page
    Then "privacy-first principles" should be a link

  Scenario: Forgot password flow works
    Given I am on the login page
    When I click "Forgot password?"
    Then I should see a password reset form
    When I enter my email and click "Send reset link"
    Then I should see a confirmation message

  Scenario: Only email sign-in is shown by default
    Given I am on the login page
    Then I should not see a "Continue with Google" button

  Scenario: Console is clean on page load
    Given I am on the login page
    Then no user data should be logged to the console

  Scenario: Password field has a visibility toggle
    Given I am on the login page
    When I click the password visibility toggle
    Then the password field should show plain text
