# Epic List

Implementation note: The approved architecture baseline (Next.js App Router + shadcn/ui frontend and Cookiecutter Django backend) is a delivery prerequisite, not a user-valued story. Planning assumes a hybrid delivery context: implementation starts from the approved starter baseline while integrating into this existing repository and artifact set.

## Epic 1: Guided Interview & Family Tree Capture
Users can enter family data via a guided interview, visualize the tree, and preview shares in real time.
**FRs covered:** FR-04, FR-05, FR-06, FR-07

## Story 1.1: Zero-Signup Case Start

**Implements:** FR-05

As a visitor,
I want to begin a new inheritance case immediately without creating an account,
So that I can reach the guided interview with no signup friction.

**Acceptance Criteria:**

**Given** I arrive at the application for the first time
**When** I choose to start a new case
**Then** the system creates an anonymous working session for my case
**And** I am taken directly into the guided interview flow

**Given** I have not created an account
**When** I start a case
**Then** I can proceed with the interview without authentication
**And** optional signup remains available in the navbar without blocking progress

**Given** an anonymous case session has been started
**When** I continue through the interview
**Then** the case state remains available for the duration of the active session
**And** later stories may use that same session for tree, preview, and results features

## Story 1.2: Start Interview + Madhab Selection

**Implements:** FR-06

As a visitor,
I want to start the guided interview and choose my Madhab,
So that the system can apply the correct inheritance rules.

**Acceptance Criteria:**

**Given** I am on the start screen
**When** I select one of the 5 Madhabs (4 Sunni + Jafari)
**Then** the interview begins with the selected Madhab stored in the session
**And** the UI shows the first interview question in the correct language and direction (RTL/LTR)

**Given** I have not selected a Madhab
**When** I try to start the interview
**Then** I see a clear validation message telling me to select a Madhab
**And** I cannot proceed until I select one

**Given** I change the language (Arabic/English/French) before starting
**When** the start screen re-renders
**Then** all labels update and the layout direction switches correctly

## Story 1.3: Deceased Info + Add Heirs via Guided Interview Form

**Implements:** FR-05

As a visitor,
I want to enter the deceased's information and then add heirs through a guided form,
So that the system can build my family tree accurately and apply rules correctly.

**Acceptance Criteria:**

**Given** I am in the interview flow
**When** I enter the deceased's gender and (optionally) a bequest amount
**Then** the deceased information is saved to the case session data
**And** I can proceed to add heirs

**Given** the deceased information is saved
**When** I enter a new heir’s name, relationship, and basic attributes
**Then** the heir is added to the case session data
**And** I can add another heir immediately

**Given** I attempt to submit with missing required fields
**When** I press “Save Deceased” or “Add Heir”
**Then** I see field-level validation messages
**And** the data is not saved until all required fields are valid

**Given** I need to correct the deceased or a previously added heir
**When** I choose to edit their details
**Then** I can update the fields
**And** the changes are saved to the session data

**Given** I enter a bequest amount
**When** I view the bequest in the UI
**Then** it can be displayed as amount and as derived percentage or kirat

## Story 1.4: Family Tree Visualization (Basic Render + Updates)

**Implements:** FR-05, FR-09

As a visitor,
I want to see a visual family tree that updates as I add heirs,
So that I can confirm the system understands my family structure.

**Acceptance Criteria:**

**Given** I have saved deceased info
**When** I add one or more heirs
**Then** the family tree renders the deceased and heirs as nodes
**And** relationships are visually connected

**Given** I add or edit an heir
**When** the data updates
**Then** the tree updates without a full page reload
**And** the new structure is visible immediately

**Given** there are no heirs yet
**When** I view the tree
**Then** I see a single deceased node with a clear prompt to add heirs
**And** the visual kinship graph is ready to expand as heirs are added

## Story 1.5: Real-Time Share Preview from Supported Engine Cases

**Implements:** FR-07

As a visitor,
I want to see share previews update in real time as I add heirs,
So that I can understand the impact of each change immediately.

**Acceptance Criteria:**

**Given** I have saved deceased info and added at least one heir in a preview-supported case
**When** I add or edit heirs
**Then** the UI requests a preview from the deterministic calculation engine using the current anonymous case state
**And** the UI shows the returned preview shares within the interview flow

**Given** the current case falls outside the preview-supported ruleset
**When** the preview is requested
**Then** the UI clearly states that live preview is unavailable for this case yet
**And** the user can continue the interview without being shown misleading provisional numbers

**Given** preview output is shown during the interview
**When** automated tests run
**Then** contract tests verify the preview payload shape against the engine response
**And** representative fixtures confirm that the displayed preview matches the engine output for supported cases

**Given** the preview request fails or times out
**When** the interview remains active
**Then** I see a graceful message and can continue the interview
**And** no stale preview is presented as current

## Story 1.6: Fiqh-Aware Validation + Hajb (Blocking Heirs)

**Implements:** FR-04

As a visitor,
I want the system to prevent invalid heir combinations and hide blocked heirs,
So that I only add heirs who are eligible under fiqh.

**Acceptance Criteria:**

**Given** I have added an heir who blocks other heirs (الحجب)
**When** I open the "Add Heir" options
**Then** any blocked heirs are not displayed or selectable

**Given** I enter a kinship relationship that violates fiqh rules
**When** I attempt to save the heir
**Then** I see an error message that explains what is invalid
**And** the message provides a suggested correction

**Given** I correct the invalid data
**When** I resubmit
**Then** the error clears and the heir is saved

**Given** multiple issues exist
**When** I submit
**Then** I see all relevant errors without losing my entered data

## Epic 2: Multi-School Deterministic Inheritance Engine
Users receive deterministic inheritance calculations for all 4 Sunni Madhabs and the Jafari school, with measurable rule coverage, proof output, and no manual overrides.
**FRs covered:** FR-01, FR-02, FR-03, FR-16

## Story 2.1: Standard Share Calculation Across All Required Schools

**Implements:** FR-01, FR-16

As a legal user,
I want standard inheritance cases calculated across all 4 Sunni Madhabs and the Jafari school,
So that the platform fulfills the required school coverage for first-level inheritance cases.

**Acceptance Criteria:**

**Given** a supported standard inheritance case
**When** I select any of the 4 Sunni Madhabs or the Jafari school
**Then** the system calculates the case according to the selected school
**And** the result differs where school rules differ

**Given** a school-specific rule changes eligibility or share amount
**When** the calculation completes
**Then** the output reflects the selected school's rule set deterministically

**Given** blocked or invalid heir data reaches the engine
**When** validation runs
**Then** the calculation fails safely
**And** no manual override path is available

## Story 2.2: Deterministic Proof Output for Multi-School Results

**Implements:** FR-03

As a legal user,
I want each supported school calculation to include deterministic proof output,
So that every result can be traced to the selected legal rule set.

**Acceptance Criteria:**

**Given** a supported calculation is completed for any required school
**When** the result is returned
**Then** the system includes structured proof output for the selected school
**And** the same input and school selection always produce the same proof structure

**Given** two schools differ on the same supported case
**When** the user compares outputs
**Then** the proof output reflects the school-specific legal basis for the difference

## Story 2.3: Expanded Multi-School Coverage Beyond Standard Cases

**Implements:** FR-01

As a legal user,
I want broader supported inheritance scenarios across all required schools,
So that the engine handles more than a narrow primary-heir subset.

**Acceptance Criteria:**

**Given** a supported non-trivial inheritance scenario
**When** the engine runs
**Then** the system returns a deterministic result for the selected required school

**Given** a scenario is not yet supported
**When** the engine evaluates it
**Then** the system returns a clear unsupported-case response
**And** it does not silently degrade to an incorrect result

## Story 2.4: Full Recursive Manasikhat Calculation

**Implements:** FR-02, FR-03

As a legal user,
I want the engine to resolve full recursive multi-generational Manasikhat cases,
So that complex successive inheritance cascades are handled correctly end to end.

**Acceptance Criteria:**

**Given** a supported recursive Manasikhat case spanning multiple inheritance layers
**When** the engine executes the calculation
**Then** the system resolves the full cascade recursively
**And** produces deterministic final shares for the surviving eligible heirs

**Given** the same recursive case is recalculated
**When** the engine runs again
**Then** the result and proof output are identical

**Given** a recursive case exceeds currently supported boundaries
**When** the engine evaluates it
**Then** the system returns a clear unsupported-case response
**And** identifies that the failure is due to unsupported recursion scope rather than generic engine failure

## Epic 3: Results & Court-Ready Report
Users can view results and generate a draft or certified PDF report with clear certification status and disclaimers.
**FRs covered:** FR-08, FR-09, FR-10

## Story 3.1: Results View for Eligible Heirs

**Implements:** FR-09

As a visitor,
I want to see the calculated inheritance results on screen,
So that I can review the distribution before saving, printing, or sharing.

**Acceptance Criteria:**

**Given** a successful calculation exists
**When** I open the results view
**Then** I see each eligible heir with their share
**And** the share can be presented in amount, percentage, and kirat as applicable

**Given** the calculation includes proof data
**When** I inspect a result entry
**Then** I can view the explanation for how that share was derived
**And** I can view fiqh citations and the visual kinship graph for the calculated case

**Given** no valid result is available
**When** I open the results view
**Then** I see a clear empty or error state
**And** I am guided back to correct the case input

## Story 3.2: Draft PDF Report Generation with Certification Disclaimer

**Implements:** FR-08, FR-09, FR-10

As a visitor,
I want to generate a formal PDF report for the calculated case,
So that I can keep, review, or share a draft inheritance report.

**Acceptance Criteria:**

**Given** a successful calculation exists
**When** I generate the PDF report
**Then** the system produces a downloadable PDF containing the eligible heirs and their shares
**And** the report includes the supporting proof summary and fiqh citations

**Given** the report has not been certified by a registered lawyer
**When** the PDF is generated
**Then** the report displays a clear disclaimer that it is a draft or not certified
**And** the disclaimer is visible enough that it cannot be mistaken for a certified report

**Given** the report is not yet certified
**When** the PDF is generated
**Then** no certified status, seal, or equivalent claim is shown in the report

**Given** PDF generation fails
**When** I request the report
**Then** I see a clear failure message
**And** I can retry without losing the calculation result

## Epic 4: Save, Share, and Privacy
Users can save cases optionally, share reports, and control privacy/anonymization.
**FRs covered:** FR-18, FR-19

## Story 4.1: Account Creation Gate for Save and Sharing

**Implements:** FR-18

As a visitor,
I want to be prompted to register before using persistence or protected sharing features,
So that sensitive case data is only stored or shared from an authenticated account.

**Acceptance Criteria:**

**Given** I am not signed in
**When** I attempt to save a case or use a protected sharing feature
**Then** I am prompted to create an account or sign in
**And** the action is blocked until authentication is completed

**Given** I complete registration or sign-in successfully
**When** I return to the interrupted action
**Then** I can continue without losing the current calculation context

## Story 4.2: Save Draft Report to Registered Account

**Implements:** FR-18, FR-19

As a registered user,
I want to save a draft case and its report to my account,
So that I can return to it later securely.

**Acceptance Criteria:**

**Given** I am signed in and have a valid draft result
**When** I choose to save the case
**Then** the draft case and report are stored under my account
**And** the saved record remains marked as draft or not certified

**Given** I am not signed in
**When** I choose to save the case
**Then** I am required to register or sign in before the save completes

## Story 4.3: Private Link Sharing with Explicit Public Consent

**Implements:** FR-18, FR-19

As a registered user,
I want shared links to remain private by default and require explicit consent before making them public,
So that I do not accidentally expose private family information.

**Acceptance Criteria:**

**Given** I am signed in and create a shareable link
**When** I use the default sharing option
**Then** the generated link is private to authorized access only
**And** it is not publicly accessible by default

**Given** I choose to make a link public
**When** I confirm the public sharing action
**Then** the system shows a clear warning that anyone with the link may access private information
**And** the public link is not created unless I explicitly accept that warning

**Given** a shared report is accessed through any link
**When** the report is shown
**Then** the draft or certification status remains clearly visible

## Story 4.4: Share Report with Registered Users or Email Invitees

**Implements:** FR-18, FR-19

As a registered user,
I want to share a report with specific users or email recipients who must register,
So that I can control who can access private inheritance data.

**Acceptance Criteria:**

**Given** I am signed in and have a saved draft report
**When** I share it with another registered user
**Then** only that authorized user can access the shared report

**Given** I share the report to an email address
**When** the recipient opens the invitation
**Then** the recipient must register or sign in before accessing the report
**And** access is granted only after successful registration and authorization

**Given** I revoke or change sharing permissions
**When** access rules are updated
**Then** previously unauthorized users can no longer access the shared report

## Story 4.5: WhatsApp Share for Registered Users

**Implements:** FR-18, FR-19

As a registered user,
I want to share a draft report through WhatsApp,
So that I can send the result to selected recipients from my account.

**Acceptance Criteria:**

**Given** I am signed in and have a saved draft report
**When** I choose WhatsApp sharing
**Then** the system prepares the report or link for WhatsApp sharing
**And** the shared content preserves the draft or non-certified disclaimer

**Given** I am not signed in
**When** I attempt WhatsApp sharing
**Then** I am prompted to create an account or sign in
**And** WhatsApp sharing is blocked until authentication is completed

**Given** WhatsApp sharing is unavailable on the current device
**When** I try to share through WhatsApp
**Then** I see a clear fallback message
**And** I can return to the report without losing progress

## Epic 5: Lawyer Registration and Approval
Lawyers can apply for professional access, administrators can review applications, and only approved lawyers gain certification privileges.
**FRs covered:** FR-11

## Story 5.1: Public Lawyer Application

**Implements:** FR-11

As a lawyer applicant,
I want to register and submit my professional details for review,
So that I can request access to certification features.

**Acceptance Criteria:**

**Given** I am a lawyer user without an approved account
**When** I choose lawyer registration
**Then** I can submit an application with the required identity and professional information
**And** the application is stored with a pending review status

**Given** I submit an incomplete application
**When** I attempt to continue
**Then** I see clear validation errors
**And** the application is not submitted until required fields are complete

## Story 5.2: Internal Lawyer Approval Workflow

**Implements:** FR-11

As an internal administrator,
I want to review lawyer applications and approve or reject them,
So that only verified professionals can gain certification access.

**Acceptance Criteria:**

**Given** a lawyer application is pending
**When** an administrator reviews the submission
**Then** the administrator can approve or reject the application
**And** the decision is stored with its resulting status

**Given** an application is approved
**When** the approval is completed
**Then** the lawyer account receives certification eligibility permissions

**Given** an application is rejected
**When** the decision is completed
**Then** the lawyer cannot access certification actions
**And** the rejected status is visible on the account

## Story 5.3: Certification Access Control by Lawyer Status

**Implements:** FR-11

As an approved lawyer,
I want certification actions to appear only when my professional status allows it,
So that certification capability is restricted to authorized accounts.

**Acceptance Criteria:**

**Given** I am not an approved lawyer
**When** I view a report
**Then** certification actions are hidden or blocked

**Given** I am an approved lawyer
**When** I open an eligible draft report
**Then** certification actions are available to me

**Given** my lawyer approval is pending, revoked, or rejected
**When** I attempt to access certification features
**Then** the system blocks certification access
**And** shows my current approval status clearly

## Epic 6: Lawyer Membership, Pricing, and Sponsorship
Approved lawyers can manage their commercial setup, including membership plan, pricing model, sponsorship, and earned badge eligibility.
**FRs covered:** FR-12, FR-14
**Sequencing note:** This epic is part of the planned Phase 1 certification flow, but should start after the anonymous calculation, core engine, results, and save/privacy flows are stable enough to support paid certification demand.

## Story 6.1: Default Free Membership with Commission Rules

**Implements:** Supporting commercialization prerequisite for Phase 1 certification flow

As an approved lawyer,
I want to start on a default free membership plan,
So that I can offer certifications immediately under the platform's base commission terms.

**Acceptance Criteria:**

**Given** a lawyer account becomes approved
**When** no paid membership has been selected
**Then** the lawyer is assigned the free membership plan automatically
**And** the plan applies a 20 percent platform commission plus payment processing fees to each transaction

**Given** a certification transaction is priced under the free plan
**When** the platform calculates fees
**Then** the commission and processing fees are applied deterministically
**And** the lawyer can see the expected net amount

## Story 6.2: Membership Upgrade to Internal Tiers

**Implements:** Supporting commercialization prerequisite for Phase 1 certification flow

As an approved lawyer,
I want to upgrade to a higher membership tier with fixed monthly fees and lower commission rates,
So that I can choose a commercial plan that fits my expected certification volume.

**Acceptance Criteria:**

**Given** I am an approved lawyer on any active membership plan
**When** I view available membership options
**Then** I can compare the internal tiers by monthly fee and commission rate

**Given** I select a higher tier successfully
**When** the upgrade is activated
**Then** future transactions use the new commission rules
**And** the membership tier remains internal and is not shown as a public trust badge

## Story 6.3: Lawyer-Defined Certification Pricing Model

**Implements:** FR-12

As an approved lawyer,
I want to configure my certification pricing model,
So that I can set my own market rate without platform-controlled pricing.

**Acceptance Criteria:**

**Given** I am an approved lawyer
**When** I configure certification pricing
**Then** I can set a minimum fee, a percentage of bequest, or the higher of the two
**And** the listed pricing model is stored for marketplace use

**Given** the platform has an acceptable suggested pricing range
**When** I set or edit my price
**Then** the platform may show guidance
**And** the final listed price remains lawyer-controlled

## Story 6.4: Sponsored Fixed Position Management

**Implements:** FR-14

As an approved lawyer,
I want to purchase fixed sponsored placement positions,
So that I can receive labeled priority visibility in the lawyer marketplace.

**Acceptance Criteria:**

**Given** sponsored positions are available for the relevant market context
**When** I purchase a sponsored slot
**Then** the slot is reserved for the configured period
**And** the placement is shown in a clearly labeled sponsored section

**Given** all sponsored positions are full
**When** I attempt to purchase sponsorship
**Then** the system prevents oversubscription
**And** shows that no slot is currently available

## Story 6.5: Earned Badge Eligibility Rules

**Implements:** FR-14

As a system owner,
I want public lawyer badges to be earned from real service performance,
So that users see meaningful trust signals rather than paid status markers.

**Acceptance Criteria:**

**Given** lawyers appear in the marketplace
**When** badge rules are evaluated
**Then** only earned badges such as top rated or fast response can be shown publicly
**And** internal membership tiers are never shown as public badges

**Given** a badge depends on verified service data
**When** the underlying metrics change
**Then** badge eligibility updates according to the defined rules

## Epic 7: Lawyer Marketplace, Certification Purchase, and Audit
Users can unlock lawyer pricing, choose an approved lawyer, purchase certification, and rely on auditable certification outcomes.
**FRs covered:** FR-13, FR-15, FR-17
**Sequencing note:** This epic is in the Phase 1 certification flow and depends on Epic 6 commercial setup plus the reporting flows from Epic 3 and Epic 4.

## Story 7.1: Bequest Amount Gate for Lawyer Pricing

**Implements:** FR-13

As a user seeking certification,
I want lawyer prices hidden until I provide the bequest amount,
So that all lawyer prices are computed fairly on the same declared basis.

**Acceptance Criteria:**

**Given** I have a calculated case but no bequest amount
**When** I attempt to enter the lawyer certification marketplace
**Then** no lawyer prices are shown
**And** I am prompted to enter the bequest amount before continuing

**Given** I provide the bequest amount
**When** pricing is unlocked
**Then** lawyer prices are computed from the declared amount
**And** price comparison becomes available across the visible lawyers

## Story 7.2: Lawyer Marketplace Listing with Sponsored and Earned Signals

**Implements:** FR-13, FR-14

As a user seeking certification,
I want to browse approved lawyers with clear sponsored labeling and earned trust signals,
So that I can choose a lawyer without being misled by hidden ranking rules.

**Acceptance Criteria:**

**Given** pricing has been unlocked
**When** I view the lawyer marketplace
**Then** only approved lawyers appear in the list
**And** sponsored lawyers, if any, appear in clearly labeled fixed sponsored positions

**Given** lawyers have earned public badges or review metrics
**When** I compare lawyers
**Then** I can see differentiating signals such as ratings, review counts, response time, or earned badges
**And** internal membership tiers are not displayed

## Story 7.3: Verified Review and Rating Generation

**Implements:** FR-14

As a system owner,
I want lawyer ratings and reviews to come only from verified completed certification orders,
So that marketplace evaluations remain credible and resistant to abuse.

**Acceptance Criteria:**

**Given** a certification order has been completed successfully
**When** the purchasing user is invited to rate the lawyer
**Then** that user can submit one verified review for that order

**Given** no completed certification order exists
**When** a user attempts to rate a lawyer
**Then** the system prevents the review from being created

## Story 7.4: Certification Purchase and Lawyer Selection

**Implements:** FR-13

As a user seeking certification,
I want to choose a lawyer and pay for certification,
So that my draft report can enter the lawyer certification process.

**Acceptance Criteria:**

**Given** pricing is unlocked and I select an approved lawyer
**When** I proceed to purchase certification
**Then** the system shows the calculated checkout price using the lawyer's pricing model
**And** the order is linked to the chosen lawyer and report

**Given** the purchase is completed successfully
**When** the order is confirmed
**Then** the report enters the lawyer certification workflow
**And** the user can track the certification request status

## Story 7.5: Certify Draft Report as Approved Lawyer

**Implements:** FR-15

As an approved lawyer,
I want to certify an eligible purchased draft report,
So that the report can move from draft status to lawyer-certified status.

**Acceptance Criteria:**

**Given** I am an approved lawyer viewing a purchased certification request assigned to me
**When** I complete the certification action
**Then** the report status changes to certified
**And** uncertified draft disclaimers are removed or replaced with certified status indicators

**Given** I am not the assigned approved lawyer
**When** I attempt certification
**Then** the action is blocked
**And** the report remains uncertified

## Story 7.6: Audit Trail for Certification Actions

**Implements:** FR-17

As a system owner,
I want all certification-related actions recorded in an audit trail,
So that report trust and accountability can be reviewed later.

**Acceptance Criteria:**

**Given** a certification action is performed
**When** a lawyer certifies a report or the certification state changes
**Then** the system records the acting user, the report, the timestamp, and the resulting status

**Given** a certification attempt is blocked or fails validation
**When** the action is processed
**Then** the system records the failed or denied event for audit purposes

**Given** an audit record exists
**When** authorized staff review the certification history
**Then** they can see a chronological record of certification-related events
