# Product Plan

Implementation note: For the Heroku-to-Hetzner phase, the authoritative implementation contract is `_bmad-output/specs/spec-heroku-to-hetzner/SPEC.md` and its companion architecture spine. Epic 0 executes against the existing Django monolith and must not require a `web/` plus `api/` split. Product Epics 1 through 7 remain the roadmap after migration stabilization; any Next.js or DRF modernization must be separately approved before it becomes a delivery prerequisite.

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

## Story 1.7: Successive Deaths (Manasikhat) in the Interview

**Implements:** FR-02, FR-05, FR-07

As a visitor,
I want to say that an heir has also died and add that heir's own heirs in the same interview,
So that a case with successive deaths is captured and previewed without starting over.

**Acceptance Criteria:**

**Given** I have added an heir who can have heirs of their own
**When** I mark that heir as also deceased
**Then** the interview asks for that person's heirs as a new layer
**And** people already in the case who are also that person's relatives (for example the mother or a brother) are linked as the same person, not entered twice
**And** the tree shows the new layer with a generation indicator, and a breadcrumb shows which death I am editing

**Given** two heirs are marked as deceased
**When** I add the second one
**Then** I am asked which of them died first
**And** a simultaneous or unknown order of death is refused with a clear message

**Given** a layered case within the engine's bounds (the first death and up to two later deaths)
**When** the preview runs
**Then** it shows each living person's combined final share of the first estate, computed by the layered engine
**And** the heirs who died later are not listed as receiving a share

**Given** a layered case the engine refuses (more than two later deaths, the Jafari school, or a refused layer)
**When** the preview runs or I try to add another death
**Then** the UI states the engine's reason and shows no provisional numbers
**And** I can continue the interview

**Given** an heir who has a later death
**When** I remove that heir, or unmark them as deceased, and confirm
**Then** their layer and its heirs are removed with them, and no orphaned layer remains

**Given** overlapping edits and preview requests on one layered case
**When** they run at the same time
**Then** the whole case is locked so a preview never reads a half-written layer, and no request fails with a server error

**Given** layered input and preview output
**When** automated tests run
**Then** contract tests check the layered request and preview payloads against the engine
**And** the Story 2.4 matrix fixtures match the displayed final shares

**Out of scope:** the dedicated lawyer Manasikhat mode, showing the per-layer proof (Epic 3), the legacy Django pages, a later deceased's own separate property, and simultaneous deaths (gharqa).

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

**Given** the open-core boundary (AD-14)
**When** the report status and disclaimer are rendered
**Then** the public code reads the status only through the report-status extension point, which returns "draft" when no private package is installed
**And** no certified seal, signature, registry link or certification wording is implemented in the public repository

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

## Epic 6: Lawyer Membership, Pricing, and Sponsorship
Approved lawyers can manage their commercial setup, including membership plan, pricing model, sponsorship, and earned badge eligibility.
**FRs covered:** FR-12, FR-14

## Epic 7: Lawyer Marketplace, Certification Purchase, and Audit
Users can unlock lawyer pricing, choose an approved lawyer, purchase certification, and rely on auditable certification outcomes.
**FRs covered:** FR-13, FR-15, FR-17

**Story detail for Epics 5–7** lives in the private repository `asamawi/mawareeth-marketplace` (AD-14). The only Epic 5–7 work in this repository is from Story 5.0: a report-status extension point that returns "draft" when the private package is absent, and a CONTRIBUTING file requiring a CLA for outside contributions.
