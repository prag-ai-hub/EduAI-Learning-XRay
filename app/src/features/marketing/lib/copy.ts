/**
 * Every word on the public landing page, and the sample data its two
 * illustrations are drawn from.
 *
 * Ported from frontend/app/ui/MarketingHome.tsx. In the web app most of this
 * was written inline in JSX; separating it means the React Native screen is
 * layout only, and means the copy can be reviewed - by someone who does not
 * read TSX - without touching a component.
 *
 * Nothing here imports anything. The heat grid, the persona tabs and the FAQ
 * all render from these constants, so a change to the wording is a change to
 * one file.
 *
 * HTML entities from the original (`can&apos;t`, `child&apos;s`) are plain
 * apostrophes here: React Native's <Text> renders the string it is given and
 * does not decode entities.
 */

// ---------------------------------------------------------------------------
// Navigation and hero
// ---------------------------------------------------------------------------

export const brand = {
  title: 'Learning X-Ray',
  company: 'EduIntelligence Hubs Pvt. Ltd.',
  footerLine: 'EduIntelligence Hubs Pvt. Ltd. · Chandigarh, India',
} as const;

export const contactEmail = 'contact@eduaihub.in';

export const hero = {
  eyebrow: 'EduAI Hub · Learning X-Ray',
  heading: 'Marks tell you who scored. Learning X-Ray tells you why.',
  lead: 'Teacher-approved AI that sets the paper, checks the work, maps every concept gap in your class, and generates the exact practice each child needs - then reassesses to prove the gap actually closed.',
  trust: [
    '✓ Teacher approves every mark',
    '○ No rankings. No labels.',
    '◆ Built for Indian school boards',
  ],
  primaryCta: 'Run a free X-Ray on your last class test',
  secondaryCta: 'See a sample Class 9 heatmap →',
  micro: 'Upload a test you have already conducted. Get the class heatmap and one personalised worksheet back. No setup, no integration, no cost.',
} as const;

export const explainer = {
  eyebrow: 'The five-second explainer',
  heading: "A blood test tells you what a thermometer can't.",
  paragraphs: [
    'A mark sheet says a child scored 62%. It does not say the child understands balancing equations but cannot read a mole ratio. One number hides thirty different reasons.',
    'Learning X-Ray reads the same answer scripts your teachers already correct and returns the reasons - concept by concept, child by child - with the practice material to fix each one.',
  ],
} as const;

// ---------------------------------------------------------------------------
// Personas
// ---------------------------------------------------------------------------

/**
 * The three audiences, keyed by the tab label. Each owns the outcome its
 * reader is accountable for, which is why the copy is not shared between them.
 */
export const personas = {
  Teacher: {
    icon: "▤", title: "Get your Sundays back.",
    points: ["Build a full question paper from a blueprint in minutes, not evenings.","Generate the answer key and marking scheme together, then approve both before anyone sees a mark.","Upload answer scripts. AI applies your approved scheme, including step marks and partial credit.","Change a step mark and regrade the whole set in one click.","You are the final authority on every single mark. Always."],
  },
  "Principal & Academic Head": {
    icon: "▦", title: "Stop discovering problems in March.",
    points: ["Concept-level heatmaps across every section and subject, updated after every assessment.","See prerequisite gaps carrying forward between classes while there is still time to act.","Intervention groups form per concept and dissolve when the concept is fixed. No permanent label.","Keep an evidence trail for moderation, PTM and inspection.","Compare intended teaching with demonstrated learning - the competency gap schools need to close."],
  },
  "School Owner & Chain": {
    icon: "⌘", title: "Learning improvement you can show a parent.",
    points: ["Every PTM can end with a teacher-approved concept report and a 30-day plan for that child.","Show parents what their child does not yet understand - and the plan to address it.","Reassessment evidence shows whether the intervention worked.","Use the papers and answer scripts your school already produces. No new hardware or curriculum change.","Deploy branch by branch with one academic standard across the network."],
  },
} as const;

export type PersonaKey = keyof typeof personas;

export const personasHeader = {
  eyebrow: 'Built around the outcome you own',
  heading: 'Three people. One platform. Three different problems solved.',
} as const;

// ---------------------------------------------------------------------------
// The sample heatmap
// ---------------------------------------------------------------------------

export const heatHeader = {
  eyebrow: 'Illustrative, anonymised Class 9 Science view',
  heading: 'One class. Twelve concepts. The pattern becomes visible.',
} as const;

/** The twelve rows of the sample grid. */
export const concepts = [
  "Atoms & molecules",
  "Mole ratio",
  "Balancing",
  "Mass conservation",
  "Limiting reagent",
  "Unit conversion",
  "Formula writing",
  "Valency",
  "Reaction types",
  "Stoichiometry",
  "Yield",
  "Scientific notation",
] as const;

/** The eight columns - initials, because the sample is anonymised. */
export const students = ["AS","RK","PM","NV","SK","AD","TM","RJ"] as const;

/**
 * The grid itself, row-major: `heat[row * students.length + column]`.
 *
 * 0 = needs attention, 1 = partial, 2 = secure. Kept as a flat array of the
 * same length and order as the web app so the illustration is identical; the
 * legend order (`["gap","partial","secure"]`) indexes straight into it.
 */
export const heat = [
  2, 2, 1, 2, 1, 2, 2, 1,
  2, 0, 1, 0, 0, 1, 0, 1,
  2, 2, 2, 1, 2, 2, 1, 2,
  1, 0, 1, 0, 1, 0, 0, 1,
  0, 0, 1, 0, 0, 1, 0, 0,
  2, 1, 2, 1, 2, 1, 1, 2,
  2, 2, 1, 2, 2, 1, 2, 1,
  2, 1, 1, 2, 1, 2, 1, 1,
  1, 1, 2, 1, 1, 2, 1, 1,
  1, 0, 1, 0, 1, 0, 0, 1,
  2, 1, 2, 2, 1, 2, 2, 1,
  2, 2, 1, 2, 2, 1, 2, 2,
] as const;

/** The three read-outs beside the grid - the point the illustration is making. */
export const heatNotes = [
  ['01', 'Nine students missed the same prerequisite from the previous class.'],
  ['02', 'This is a concept problem, not a chapter problem.'],
  ['03', 'Group formed for this concept only. Dissolves on reassessment.'],
] as const;

export const heatKey = ['Secure', 'Partial', 'Needs attention'] as const;

// ---------------------------------------------------------------------------
// How it works
// ---------------------------------------------------------------------------

export const howHeader = {
  eyebrow: 'How it works',
  heading: 'From blank paper to proven improvement.',
} as const;

/** Each stage as [name, what happens, who signs it off]. The fifth is the one that matters. */
export const stages = [
  ["Set","Choose outcomes, difficulty, cognitive level, question types and marks. Paper, key and rubric generate together.","Teacher approves"],
  ["Check","Upload tests, homework or assignments. AI applies the approved scheme with step and partial marks.","Teacher approves"],
  ["See","Class and student heatmaps surface concept understanding, prerequisites and misconceptions.","Evidence linked"],
  ["Act","Create temporary intervention groups and personalised practice for regular or remedial periods.","Teacher assigns"],
  ["Prove","Reassess the same concepts and show whether understanding actually moved.","Improvement verified"],
] as const;

export const stagesClosingLine =
  'Most platforms stop at Stage 3. Stage 5 is the one that changes a board result.';

// ---------------------------------------------------------------------------
// Teacher authority
// ---------------------------------------------------------------------------

export const authorityHeader = {
  eyebrow: 'Teacher authority',
  heading: 'What Learning X-Ray will never do.',
} as const;

/** [never, always]. The promises the product is built around, stated as a pair. */
export const authorityRows = [
  ["Publish a mark you have not approved","Hold every AI mark as a draft until you sign off"],
  ["Rank students against each other","Report each child against the concept, not the class"],
  ["Label a child weak or slow","Group by concept temporarily, then dissolve the group"],
  ["Report teacher performance to management","Report learning gaps so teaching can be supported"],
  ["Replace professional judgement","Show the evidence behind every suggestion"],
] as const;

// ---------------------------------------------------------------------------
// Founding cohort
// ---------------------------------------------------------------------------

export const founding = {
  eyebrow: 'Evidence, not adjectives',
  heading: 'Be one of the first ten.',
  body: 'We are running Learning X-Ray with ten schools, free, for 15 days - 2 classes, 2 teachers and up to 100 students per school. You keep every report generated. We publish results only with your permission.',
  cta: 'Apply for the founding cohort',
  ctaSubject: 'Learning X-Ray founding cohort',
} as const;

// ---------------------------------------------------------------------------
// Fits the school you already run
// ---------------------------------------------------------------------------

export const worksHeader = {
  eyebrow: 'Fits the school you already run',
  heading: 'No new hardware. No new curriculum. No new textbook.',
} as const;

export const worksWith = [
  "Your existing question papers and answer scripts",
  "Handwritten work with mandatory teacher validation of extracted text",
  "Your marking scheme and moderation rules",
  "CBSE, ICSE and State-board assessment patterns",
  "Teacher-approved reports ready for school workflows",
  "Secure access by role and section",
] as const;

// ---------------------------------------------------------------------------
// Data and child safety
// ---------------------------------------------------------------------------

export const safety = {
  eyebrow: 'Data & child safety',
  heading: 'Student data stays under school control.',
  body: "Teachers see their sections, Principals see the school, and parents see only their own child's approved report. Every mark and regrade keeps an audit trail. Ask us for the current data-processing, hosting and retention documentation during your review.",
  seal: {
    title: 'Teacher-approved',
    note: 'Role-based access · audit history · secure parent sharing',
  },
} as const;

// ---------------------------------------------------------------------------
// Rollout
// ---------------------------------------------------------------------------

export const rolloutHeader = {
  eyebrow: 'Rollout',
  heading: 'Six weeks from first upload to proven improvement.',
} as const;

/** [week, what happens, what it costs the school in time]. */
export const rolloutWeeks = [
  ["1","Onboard two teachers and upload one existing test.","90 min"],
  ["2","Review the first heatmap with the academic head.","1 meeting"],
  ["3–4","Assign practice and run intervention in normal periods.","Existing timetable"],
  ["5","Reassess the same concepts.","1 period"],
  ["6","Share improvement and PTM reports.","As scheduled"],
] as const;

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

export const pricing = {
  eyebrow: 'Simple commercial model',
  heading: 'Priced per classroom, not per feature.',
  body: 'One annual classroom licence. Blueprint, grading, heatmaps, practice generation, reassessment and reports are included. Multi-branch pricing and year-one onboarding are available.',
  cta: 'Get a costing for your school',
  ctaSubject: 'Learning X-Ray costing',
} as const;

// ---------------------------------------------------------------------------
// FAQ and closing
// ---------------------------------------------------------------------------

export const faqHeader = {
  eyebrow: 'Frequently asked questions',
  heading: 'Straight answers before you pilot.',
} as const;

/** [question, answer]. Every one of these is an objection a school raised. */
export const faq = [
  ["Does the AI decide my students' marks?","No. It applies the marking scheme you approved and produces a draft. Nothing is final until the teacher confirms it."],
  ["Will this be used to evaluate teachers?","No. Learning X-Ray reports concept gaps, not teacher performance. The purpose is to support teaching, not score it."],
  ["Does it work with handwritten answer scripts?","It can extract text from clear scanned handwriting, but results vary with legibility, scan quality, language, diagrams and subject notation. Teachers must review and correct the extracted text before analysis."],
  ["What if a teacher disagrees with the grading?","The teacher overrides it. The override is recorded, and the same correction can be applied across the set."],
  ["How much extra work is this?","The aim is less work: paper setting and checking get faster, while diagnosis and practice material are generated for review."],
  ["Do children get labelled as weak?","No. Groups are tied to one concept and dissolve when that concept is fixed. There is no permanent student tag."],
] as const;

export const finalCta = {
  eyebrow: 'Start with work your teachers already have',
  heading: "You already have the answer scripts. Let's read them properly.",
  primary: 'Run a free X-Ray on your last class test',
  secondary: 'Talk to us for 20 minutes',
  secondarySubject: 'Learning X-Ray conversation',
  signin: 'Already a school on Learning X-Ray? Sign in →',
} as const;
