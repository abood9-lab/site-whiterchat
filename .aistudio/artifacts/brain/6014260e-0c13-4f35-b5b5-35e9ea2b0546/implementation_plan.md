# Prompt-Docked Secrets & Wizard + Workbench Plan & Secrets Tabs

Replace popup modals with an integrated, zero-modal workspace flow: requested API secrets and step-by-step clarifying questions slide smoothly out of the top of the AI prompt box only when needed, while the full Implementation Plan and `.env` Secrets Manager live as dedicated tabs inside the Workbench alongside Code and Preview.

---

### User Review & Critical Decisions

> [!IMPORTANT] All layout, docking, and tab organization preferences have been confirmed and integrated into this plan.

- **Confirmed Decision 1 — Collapsible Prompt-Docked Trays**: Both the **API Secrets Tray** and the **Clarifying Questions Wizard** expand smoothly right above the AI prompt box (with a collapse/minimize toggle) so the conversation remains readable and nothing blocks the screen as a popup modal.
- **Confirmed Decision 2 — Unified Workbench Tab Strip**: The Workbench header displays a unified segmented tab bar containing **Code**, **Preview**, **Secrets** (always visible), and **Plan** (shown dynamically whenever a plan is available).
- **Confirmed Decision 3 — Auto-Open Plan Tab**: As soon as the AI finishes generating the implementation plan after the questions wizard, the Workbench automatically opens and switches directly to the **Plan** tab for review, revision, and build execution.

---

### 1. Overview & Core Concept

- **What It Does**: Creates a calm, IDE-native workflow where lightweight **just-in-time inputs** (entering newly requested API keys or stepping through clarifying questions one at a time) dock directly onto the AI prompt composer, while **deep workspace artifacts** (reading/revising the full implementation blueprint or managing/adding `.env` variables) live in full-height Workbench tabs next to the code editor and live preview.
- **Target Audience / Persona**: Builders and developers using Plan Mode and building full-stack API-backed applications who want uninterrupted spatial focus without overlapping dialog popups.
- **Key Value**: Eliminates modal fatigue, keeps prompt-time questions brisk with a 1-question-at-a-time Next/Previous flow, shows only newly requested secrets above the prompt box, and gives full editorial room in the Workbench for reviewing plans and managing `.env` secrets.

---

### 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Prompt-Docked API Secrets Tray (Context-Triggered Only)**:
     - Remains completely hidden during normal chatting and whenever no new secrets are requested.
     - As soon as the AI requests API secrets for a build, a crisp tray unfolds cleanly above the AI prompt box displaying **only the specific keys the AI requested** for that task.
     - Each field provides a monospace variable key, brief description, masked password input (`type="password"`) with a reveal eye button, a **Paste `.env`** toggle for quick multi-line pasting, **Skip for now**, **Save to `.env`**, and a **Minimize** chevron to tuck it into a 1-line docked header bar if needed.
  2. **Prompt-Docked Step-by-Step Questions Wizard (`Next` / `Previous`)**:
     - When the AI sends clarifying questions in Plan Mode, the tray unfolds smoothly above the AI prompt box showing **one question at a time** (with a slim top progress bar and `01 / 04` counter).
     - Each step displays clickable choice cards (`A`, `B`, `C`, ...) and a custom answer field.
     - Clicking **Next** advances smoothly to the next question; **Previous** navigates back without losing selections; the final step's button reads **Create Plan** (plus a quiet **Skip all** action).
  3. **Workbench `Plan` Tab (Auto-Opened on Blueprint Ready)**:
     - As soon as the AI finishes generating the plan, the Workbench opens automatically on the unified **Plan** tab (`Code | Preview | Plan | Secrets`).
     - Displays a structured two-pane layout: a left outline rail (`01`, `02`, ...) for quick section navigation + status indicators, and a readable Markdown blueprint pane on the right, anchored by a bottom bar to enter revision notes (**Revise Plan**) or click **Approve & Start Building**.
  4. **Workbench `Secrets` Tab (Full `.env` Manager)**:
     - Clicking **Secrets** in the Workbench header opens the dedicated **Secrets** view showing all configured keys currently stored in `.env` as well as any unconfigured keys from `.env.example`.
     - Supports revealing/editing existing secrets, adding new custom key-value pairs, bulk importing from `.env` text, and saving directly to `.env` + `.gitignore` across both WebContainer and Daytona without ever syncing `.env` files to the cloud.

- **Visual Identity & Theme**:
  - **Unified Surface Language**: Docked prompt trays share the prompt box's horizontal width (`max-w-chat`), radius scale, and border tokens so the tray + prompt input read as a single cohesive module rather than floating boxes.
  - **Unified Workbench Tabs**: Single-elevation segmented bar using consistent height, subtle active accent highlight, `whitespace-nowrap shrink-0` labels, and `font-mono tabular-nums` counters—zero stacked pill badges or decorative dots.

- **Interactive Feedback & States**:
  - **Collapsed Dock State**: Minimizing an active tray collapses it into a clean 1-row bar anchored above the prompt box (`N keys requested · Expand` or `Question 2 of 4 · Expand`).
  - **Populated / Empty / Saved States**: Workbench **Secrets** tab shows a clear empty-state prompt with an **Add Variable** form when no `.env` exists yet, and clear toast confirmation on save.
  - **Chat Scroll Synchronization**: Chat message cards stay compact—rendering brief status summaries with direct buttons (`View Plan Tab`, `Resume Questions`, `Manage in Secrets Tab`) instead of inline modal triggers or raw blocks.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1 — Split Scope Between Prompt Dock and Workbench Secrets Tab**
  - *Chosen Approach*: The prompt-docked Secrets tray displays strictly the keys newly requested by the AI and auto-hides once saved/skipped, whereas the Workbench **Secrets** tab displays the complete project `.env` inventory and allows adding/editing variables anytime.
  - *Why*: Keeps the prompt box uncluttered and focused only on what the AI needs right now, while giving users a full management surface inside the editor panel.
  - *Alternatives Considered*: Showing all existing `.env` keys inside the prompt tray (too tall and distracting) or only showing secrets in the Workbench (user might miss immediate prompts while focused on the chat composer).

- **Decision 2 — Single-Question Wizard Above Prompt Box**
  - *Chosen Approach*: Replace the stacked all-questions card in the chat transcript with a 1-question-at-a-time wizard docked above the prompt box with `Previous` / `Next` controls.
  - *Why*: Reduces visual overwhelm, keeps chat scroll compact, and matches your exact step-by-step workflow directly next to the input controls.
  - *Alternatives Considered*: Multi-question stacked lists inside the chat stream (takes excessive vertical space and pushes user messages off-screen).

- **Decision 3 — Dynamic `Plan` Tab + Persistent `Secrets` Tab in Unified Workbench Slider**
  - *Chosen Approach*: Upgrade the Workbench header switcher to support `'code' | 'preview' | 'secrets' | 'plan'`, keeping **Secrets** permanently accessible and revealing **Plan** whenever a plan exists in the active session (auto-focusing **Plan** upon completion).
  - *Why*: Gives the implementation plan full workspace height and an outline sidebar without blocking chat or code via a modal overlay.
  - *Alternatives Considered*: Keeping a modal overlay or adding extra disconnected header buttons outside the tab bar.

---

### 4. Technical Architecture & Data Strategy

- **Architecture & Component Diagram**:

```
┌────────────────────────────────────────────────────────────────────────┐
│ Chat Stream & Parser State                                             │
│  ├─ <boltSecrets> / .env.example ──▶ Active Prompt Secret Keys         │
│  ├─ <boltPlanQuestions>          ──▶ Active Step-by-Step Questions     │
│  └─ <boltPlan>                   ──▶ Active Plan Blueprint + Auto-Tab  │
└──────────────┬──────────────────────────────────┬──────────────────────┘
               │                                  │
               ▼                                  ▼
┌─────────────────────────────────┐  ┌───────────────────────────────────┐
│ Prompt Dock (Above AI Input)    │  │ Unified Workbench Panel           │
│  ├─ Docked Secrets Tray         │  │  Header Tabs: Code|Preview|       │
│  │   (Only AI-requested keys,   │  │               Plan*|Secrets       │
│  │    collapsible, paste .env,  │  │  ├─ Code Editor + Dual Terminal   │
│  │    save to .env / skip)      │  │  ├─ Live App Preview              │
│  └─ Docked Questions Wizard     │  │  ├─ Plan Tab (Outline + Markdown  │
│      (1 question + Next/Prev,   │  │  │   + Revise + Approve & Build)  │
│       collapsible, submit)      │  │  └─ Secrets Tab (All .env keys,   │
└─────────────────────────────────┘  │      reveal, add, bulk paste)     │
                                     └───────────────────────────────────┘
```

- **Data Model & State**:
  - **Prompt Secrets Tray State**: Tracks `promptSecretsOpen` (auto-opens when AI requests unconfigured keys), `promptSecretsCollapsed`, and `promptRequestedKeys` (scoped exclusively to keys requested by the AI in the active flow). Saving writes merged values into `.env` + `.gitignore` (WebContainer & Daytona) and clears/closes the prompt tray.
  - **Questions Wizard State**: Tracks `activeQuestionBatch` (message ID + parsed questions), `currentStepIndex`, `selectedOptions`, `customAnswers`, `wizardOpen`, and `wizardCollapsed`. Submitting sends the formatted Q&A back to the AI to draft the plan and clears the active dock.
  - **Workbench Plan & Secrets State**: Tracks `currentPlan` (`title`, `markdown`, `messageId`, `isApproved`) inside the Workbench store alongside `currentView` (`'code' | 'preview' | 'plan' | 'secrets'`). When a new `<boltPlan>` finishes streaming, the store sets `currentPlan`, opens the Workbench (`showWorkbench = true`), and sets `currentView = 'plan'`.

- **Interactive Component & State Mapping**:
  - **Prompt Dock Collapse/Expand**: Clicking minimize shrinks the tray to a compact bar above the textarea without losing entered drafts or question selections; clicking expand restores it immediately.
  - **Wizard Step Transitions**: Selecting an option or typing a custom answer updates step completion state; **Next** increments `currentStepIndex` up to `questions.length - 1`; **Previous** decrements safely; final CTA dispatches the consolidated answers to `/api/chat`.
  - **Workbench Tab Switching**: Selecting `Code`, `Preview`, `Plan`, or `Secrets` animates/switches the active Workbench panel cleanly; `Secrets` reads live `.env` and `.env.example` entries on render/focus so changes from either the prompt tray or code editor stay synchronized.
  - **Plan Approval & Revision**: Clicking **Revise Plan** submits revision feedback and keeps `Plan` ready to update on the next streamed `<boltPlan>`; clicking **Approve & Start Building** switches execution mode to `build` and triggers implementation immediately.
