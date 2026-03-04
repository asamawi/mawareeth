---
stepsCompleted:
  - step-01-validate-prerequisites
  - step-02-design-epics
  - step-03-create-stories
  - step-04-final-validation
inputDocuments:
  - _bmad-output/planning-artifacts/prd.md
  - _bmad-output/planning-artifacts/architecture.md
  - _bmad-output/planning-artifacts/ux-design-specification.md
---

# mawareeth - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for mawareeth, decomposing the requirements from the PRD, UX Design if it exists, and Architecture requirements into implementable stories.

## Requirements Inventory

### Functional Requirements

FR1: System calculates shares for all 4 Sunni Madhabs and the Jafari (Shia) school.
FR2: System performs recursive calculations for multi-generational Manasikhat.
FR3: System generates deterministic mathematical proofs for every share distribution.
FR4: System identifies and flags invalid kinship inputs based on fiqh constraints.
FR5: Users input family data via interactive, step-by-step kinship discovery.
FR6: Interview adapts questions dynamically based on the selected Madhab/Sect.
FR7: Users can preview calculated shares in real-time during the interview.
FR8: System generates PDF reports formatted to Lebanese Hasr al-Irth standards.
FR9: Results and reports include exact fiqh citations, and the results experience includes a visual kinship graph.
FR10: System embeds Preliminary or Verified watermarks based on review status.
FR11: Verified lawyers can review and digitally certify calculation results.
FR12: System prevents manual overrides of engine-calculated mathematical output.
FR13: System maintains an audit log of all human verifications and engine discrepancies.
FR14: Users can perform privacy-first calculations without persisting PII.
FR15: System anonymizes sensitive financial data while preserving kinship logic.

### NonFunctional Requirements

NFR1: Standard calculations return in <200ms; complex Manasikhat in <1s.
NFR2: Maintain 99.9% uptime for both API and Web App.
NFR3: 100% deterministic logic ensured via versioned engine updates.
NFR4: Dual-state storage: ephemeral default sessions; persistent encrypted records for certified cases.
NFR5: End-to-end encryption: AES-256 at rest; TLS 1.3 in transit.
NFR6: Reports include scannable QR codes for court-side verification.
NFR7: WCAG 2.1 AA compliance with high-contrast, high-legibility Arabic fonts.
NFR8: Optimized for mobile browser performance on 3G/4G Lebanese networks.

### Additional Requirements

- Starter templates: Next.js App Router + Tailwind + shadcn/ui (frontend) and Cookiecutter Django (backend).
- Backend stack: Python 3.12 + Django + DRF; versioned REST API under /api/v1 with OpenAPI docs.
- Auth: Django auth + Google OAuth + email/password with MFA (email + TOTP + WhatsApp via Meta Cloud API).
- Error handling: RFC 7807 Problem+JSON responses.
- Data: PostgreSQL 17.x (fallback 16.x); optional Redis 8 series for cache/session/rate-limiting.
- Deployment: Hetzner VM + Docker Compose + Caddy + GitHub Actions CI/CD; dev/staging/prod separation.
- i18n/RTL: next-intl; RTL/LTR switching using logical properties.
- UI state: React Query for server state; Zustand for UI state.
- Visualization: React Flow initially, with migration path to custom SVG/d3 if performance issues.
- Deterministic engine boundary: engine is pure domain module, no DB writes, no manual overrides.
- Contract tests to ensure UI and engine alignment; Playwright E2E emphasis.
- UX: zero-friction start (no signup before calculation); optional signup after results and always available in navbar.
- UX: real-time family tree visualization with smooth add/remove feedback and share previews.
- UX: WhatsApp-first sharing, link/email sharing, and court-ready PDF generation.
- UX: certification badge states (Preliminary/Certified) and fiqh citations available on results.
- UX: accessibility and keyboard navigation, plus reduced-motion support.

### FR Coverage Map

FR1: Epic 2 - Deterministic Inheritance Engine
FR2: Epic 2 - Deterministic Inheritance Engine
FR3: Epic 2 - Deterministic Inheritance Engine
FR4: Epic 1 - Guided Interview & Family Tree Capture
FR5: Epic 1 - Guided Interview & Family Tree Capture
FR6: Epic 1 - Guided Interview & Family Tree Capture
FR7: Epic 1 - Guided Interview & Family Tree Capture
FR8: Epic 3 - Results & Court-Ready Report
FR9: Epic 3 - Results & Court-Ready Report
FR10: Epic 3 - Results & Court-Ready Report
FR11: Epic 7 - Lawyer Marketplace, Certification Purchase, and Audit
FR12: Epic 2 - Deterministic Inheritance Engine
FR13: Epic 7 - Lawyer Marketplace, Certification Purchase, and Audit
FR14: Epic 4 - Save, Share, and Privacy
FR15: Epic 4 - Save, Share, and Privacy

## Epic List

### Epic 1: Guided Interview & Family Tree Capture
Users can enter family data via a guided interview, visualize the tree, and preview shares in real time.
**FRs covered:** FR4, FR5, FR6, FR7

### Story 1.1: Initialize Project from Approved Starter Templates

**Implements:** Architecture starter template requirement

As a developer,
I want to initialize the frontend and backend from the approved starter templates,
So that implementation begins on the architecture baseline defined for the project.

**Acceptance Criteria:**

**Given** the approved architecture selects Next.js, shadcn/ui, and Cookiecutter Django
**When** the project setup story is executed
**Then** the frontend and backend are scaffolded from those starter templates
**And** the baseline dependencies and project structure are created successfully

**Given** the starter templates are initialized
**When** the repository is prepared for feature work
**Then** the project can support subsequent interview, engine, and reporting stories without re-scaffolding

### Story 1.2: Start Interview + Madhab Selection

**Implements:** FR6

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

### Story 1.3: Deceased Info + Add Heirs via Guided Interview Form

**Implements:** FR5

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

### Story 1.4: Family Tree Visualization (Basic Render + Updates)

**Implements:** FR5

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

### Story 1.5: Real-Time Share Preview (Simplified)

**Implements:** FR7

As a visitor,
I want to see share previews update in real time as I add heirs,
So that I can understand the impact of each change immediately.

**Acceptance Criteria:**

**Given** I have saved deceased info and added at least one heir
**When** I add or edit heirs
**Then** the UI shows updated share previews within the interview flow

**Given** the full engine is not yet integrated
**When** share preview is displayed
**Then** the UI clearly indicates it is a preliminary preview (not final)

**Given** the calculation fails or is unavailable
**When** the preview attempts to update
**Then** I see a graceful message and can continue the interview

### Story 1.6: Fiqh-Aware Validation + Hajb (Blocking Heirs)

**Implements:** FR4

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

### Epic 2: Deterministic Inheritance Engine
Users receive correct inheritance calculations across Madhabs, including Manasikhat, with deterministic proofs and no manual overrides.
**FRs covered:** FR1, FR2, FR3, FR12

### Story 2.1: Hanbali Core Share Engine for Primary Heirs

**Implements:** FR1, FR12

As a legal user,
I want the system to calculate Hanbali inheritance shares for the primary heirs,
So that I can get a correct first-version result under Saudi Arabia's default fiqh basis.

**Acceptance Criteria:**

**Given** a valid case with deceased details and supported primary heirs
**When** the calculation engine runs
**Then** the system returns deterministic Hanbali shares for the eligible heirs
**And** the same input always produces the same output

**Given** blocked or otherwise invalid heir data reaches the engine
**When** the engine validates the case input
**Then** the calculation is rejected with a validation failure
**And** no share distribution is produced from invalid input

**Given** a case includes an unsupported heir pattern or rule not yet implemented
**When** the engine runs
**Then** the system returns a clear unsupported-case response
**And** it does not produce a misleading final distribution

**Given** the engine completes a calculation
**When** the result is returned
**Then** each heir result includes the share basis needed for later display as fraction, percentage, or kirat

### Story 2.2: Hanbali Deterministic Proof Output for Eligible Heirs

**Implements:** FR3

As a legal user,
I want each Hanbali calculation to include a structured proof for eligible heirs only,
So that I can understand how the final shares were derived.

**Acceptance Criteria:**

**Given** the engine calculates a supported Hanbali case
**When** the result is returned
**Then** the system includes a structured explanation for each eligible heir's outcome
**And** it shows whether the heir received a fixed share or residuary share

**Given** a calculation result is used by the UI or reporting layer
**When** proof data is consumed
**Then** the explanation is returned in a structured format suitable for later rendering in Arabic and English

**Given** the same valid case is recalculated
**When** proof output is generated
**Then** the proof structure and reasoning remain deterministic

**Given** invalid or blocked heir data somehow reaches the engine
**When** the engine validates the input
**Then** the system returns a validation failure
**And** no distribution result is produced

### Story 2.3: Hanbali Expanded Case Support

**Implements:** FR1, FR2

As a legal user,
I want the engine to support more valid Hanbali family combinations beyond the primary heirs,
So that the system can handle a broader range of real inheritance cases.

**Acceptance Criteria:**

**Given** a valid Hanbali case with supported extended heir combinations
**When** the engine runs
**Then** the system returns the correct deterministic distribution

**Given** the case includes supported partial exclusions or share interactions
**When** the engine calculates
**Then** the result applies the correct Hanbali rules without manual adjustment

**Given** a new supported case type is added
**When** automated tests run
**Then** the test suite includes representative fixtures for that case type
**And** expected outputs are verified

**Given** a case still falls outside supported Hanbali coverage
**When** the engine evaluates it
**Then** the system returns a clear unsupported-case response

### Epic 3: Results & Court-Ready Report
Users can view results and generate a draft or certified PDF report with clear certification status and disclaimers.
**FRs covered:** FR8, FR9, FR10

### Story 3.1: Results View for Eligible Heirs

**Implements:** FR9

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

### Story 3.2: Draft PDF Report Generation with Certification Disclaimer

**Implements:** FR8, FR9, FR10

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

### Epic 4: Save, Share, and Privacy
Users can save cases optionally, share reports, and control privacy/anonymization.
**FRs covered:** FR14, FR15

### Story 4.1: Account Creation Gate for Save and Sharing

**Implements:** FR14

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

### Story 4.2: Save Draft Report to Registered Account

**Implements:** FR14, FR15

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

### Story 4.3: Private Link Sharing with Explicit Public Consent

**Implements:** FR14, FR15

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

### Story 4.4: Share Report with Registered Users or Email Invitees

**Implements:** FR14, FR15

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

### Story 4.5: WhatsApp Share for Registered Users

**Implements:** FR14, FR15

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

### Epic 5: Lawyer Registration and Approval
Lawyers can apply for professional access, administrators can review applications, and only approved lawyers gain certification privileges.
**FRs covered:** Supporting epic for certification readiness

### Story 5.1: Public Lawyer Application

**Implements:** Supporting story for FR11 readiness

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

### Story 5.2: Internal Lawyer Approval Workflow

**Implements:** Supporting story for FR11 readiness

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

### Story 5.3: Certification Access Control by Lawyer Status

**Implements:** Supporting story for FR11 readiness

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

### Epic 6: Lawyer Membership, Pricing, and Sponsorship
Approved lawyers can manage their commercial setup, including membership plan, pricing model, sponsorship, and earned badge eligibility.
**FRs covered:** Supporting epic for certification marketplace readiness

### Story 6.1: Default Free Membership with Commission Rules

**Implements:** Supporting story for FR11 readiness

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

### Story 6.2: Membership Upgrade to Internal Tiers

**Implements:** Supporting story for FR11 readiness

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

### Story 6.3: Lawyer-Defined Certification Pricing Model

**Implements:** Supporting story for FR11 readiness

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

### Story 6.4: Sponsored Fixed Position Management

**Implements:** Supporting story for FR11 readiness

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

### Story 6.5: Earned Badge Eligibility Rules

**Implements:** Supporting story for FR11 readiness

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

### Epic 7: Lawyer Marketplace, Certification Purchase, and Audit
Users can unlock lawyer pricing, choose an approved lawyer, purchase certification, and rely on auditable certification outcomes.
**FRs covered:** FR11, FR13

### Story 7.1: Bequest Amount Gate for Lawyer Pricing

**Implements:** FR11

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

### Story 7.2: Lawyer Marketplace Listing with Sponsored and Earned Signals

**Implements:** FR11

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

### Story 7.3: Verified Review and Rating Generation

**Implements:** Supporting story for FR11 readiness

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

### Story 7.4: Certification Purchase and Lawyer Selection

**Implements:** FR11

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

### Story 7.5: Certify Draft Report as Approved Lawyer

**Implements:** FR11

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

### Story 7.6: Audit Trail for Certification Actions

**Implements:** FR13

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
