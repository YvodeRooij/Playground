# Interview Simulator - Scalable MongoDB Schema Design

This document outlines the proposed MongoDB schema for the Interview Simulator application, designed with scalability for a large user base and a complex, multi-agent workflow in mind.

## Rationale

The primary goals of this schema are:

1.  **Scalability:** To efficiently handle potentially millions of users, numerous cases, and a high volume of interview, analysis, learning plan, and practice session data.
2.  **Performance:** To ensure fast lookups and updates through appropriate indexing and data modeling.
3.  **Data Integrity & Concurrency:** To safely manage simultaneous user activities and data updates.
4.  **Separation of Concerns:** To logically divide static case content, user profiles/state, interview results, analyses, learning plans, and practice session data.
5.  **Maintainability:** To create a clear structure that supports the full application lifecycle.

## Proposed Collections

We propose using six main collections:

### 1. `cases` Collection

*   **Purpose:** Stores the static content of each case study. Read frequently, written/updated infrequently.
*   **Fields:**
    *   `_id`: `ObjectId` (Primary Key)
    *   `caseId`: `String` (Unique, human-readable identifier) - **Index (Unique)**
    *   `company`: `String` - **Index**
    *   `title`: `String`
    *   `problemStatement`: `String`
    *   `dataPoints`: `Object`
    *   `contextForTheCase`: `Object`
    *   `interviewerHints`: `Object`
    *   `difficultyLevel`: `String` - **Index**
    *   `caseType`: `String` (e.g., "Market Entry", "PEI") - **Index**
    *   `industry`: `String` (e.g., "Automotive Technology", "N/A" for PEI) - **Index**
    *   `interviewStyle`: `String` (Optional, relevant for `caseType: "PEI"`, e.g., "interviewer-led", "candidate-led")
    *   `tags`: `Array<String>` - **Index (Multikey)**
    *   `createdAt`: `Date`
    *   `lastUpdatedAt`: `Date`
    *   `version`: `Number` (Optional)
*   **Indexes:** Critical for filtering cases during selection (e.g., by company, difficulty, `caseType`, ensuring uniqueness).

### 2. `users` Collection

*   **Purpose:** Stores user profile, preferences, current state, and progress tracking per firm. Read/written frequently.
*   **Fields:**
    *   `_id`: `ObjectId` (Primary Key)
    *   `userId`: `String` (Unique identifier from auth system/generated) - **Index (Unique)**
    *   `email`: `String` (Optional) - **Index (Unique, Sparse)**
    *   `name`: `String`
    *   `background`: `String`
    *   `preferences`: `Object`
        *   `selectedFirm`: `String` (e.g., "mckinsey", matches `cases.company` but lowercase) - **Index**
        *   *(other preferences)*
    *   `progress`: `Object` (Tracks progress per firm)
        *   `<firmId>`: `Object` (Key is lowercase firm ID, e.g., "mckinsey")
            *   `peiCompleted`: `Boolean` (Default: `false`)
            *   `completedCaseIds`: `Array<String>` (List of standard `caseId`s completed for this firm)
            *   `completedCaseCount`: `Number` (Optional: derived or stored count of standard cases)
    *   `stats`: `Object` (Optional: Aggregated overall stats)
        *   `totalInterviewsCompleted`: `Number`
        *   `totalPracticeSessionsCompleted`: `Number`
    *   `currentLearningPlanId`: `ObjectId` (Ref to active plan in `learning_plans`) - **Index**
    *   `currentInterviewState`: `Object` (Optional, for resuming interviews)
    *   `currentPracticeSessionState`: `Object` (Optional, for resuming practice)
    *   `createdAt`: `Date`
    *   `lastLoginAt`: `Date`
*   **Indexes:** Essential for user lookup (`userId`, `email`). Index on `preferences.selectedFirm` useful. Indexing within the `progress` subdocument might be needed depending on query patterns (e.g., finding all users who completed PEI for a firm).
*   **Update Strategy:** Use dot notation to update specific fields within the `progress.<firmId>` subdocument (e.g., `{$set: {"progress.mckinsey.peiCompleted": true}}`, `{$addToSet: {"progress.mckinsey.completedCaseIds": caseId}}`).

### 3. `interviews` Collection

*   **Purpose:** Stores interview transcripts and metadata. Written once per session, read by Analysis Agent and potentially users.
*   **Fields:**
    *   `_id`: `ObjectId` (Primary Key)
    *   `threadId`: `String` (Unique LangGraph thread ID) - **Index (Unique)**
    *   `userId`: `String` (Ref `users.userId`) - **Index**
    *   `caseId`: `String` (Ref `cases.caseId`) - **Index**
    *   `startedAt`: `Date`
    *   `completedAt`: `Date`
    *   `status`: `String` (e.g., "Completed", "Aborted") - **Index**
    *   `conversation`: `Array<Object>` (Transcript)
    *   `score`: `Number` (Optional, final score)
    *   `analysisId`: `ObjectId` (Optional, Ref `analyses._id`) - **Index**
*   **Indexes:** Allow finding interviews by user, case, or associated analysis.

### 4. `analyses` Collection

*   **Purpose:** Stores structured analysis output from the Analysis Agent. Written after interviews/practice, read by Learning Path Agent and potentially users.
*   **Fields:**
    *   `_id`: `ObjectId` (Primary Key)
    *   `userId`: `String` - **Index**
    *   `sourceType`: `String` ("interview" or "practice_session") - **Index**
    *   `sourceId`: `ObjectId` (Ref `interviews._id` or `practice_sessions._id`) - **Index**
    *   `caseId`: `String` (Optional, denormalized if `sourceType` is "interview") - **Index**
    *   `analysisData`: `Object` (Scores, feedback, skills assessment)
    *   `createdAt`: `Date`
*   **Indexes:** Enable finding analyses for a user, a specific source document, or by type. Compound index `{ userId: 1, createdAt: -1 }` useful for fetching latest analyses.

### 5. `learning_plans` Collection

*   **Purpose:** Stores generated learning/practice plans. Written by Learning Path Agent, read by Practice Session Agent and user.
*   **Fields:**
    *   `_id`: `ObjectId` (Primary Key)
    *   `userId`: `String` - **Index**
    *   `basedOnAnalysisId`: `ObjectId` (Ref `analyses._id`) - **Index**
    *   `planData`: `Object` (Target skills, recommended exercises)
    *   `status`: `String` ("active", "completed", "superseded") - **Index**
    *   `createdAt`: `Date`
    *   `completedAt`: `Date` (Optional)
*   **Indexes:** Allow finding a user's active plan or historical plans.

### 6. `practice_sessions` Collection

*   **Purpose:** Stores practice session transcripts/data. Written after practice, read by Analysis Agent.
*   **Fields:**
    *   `_id`: `ObjectId` (Primary Key)
    *   `threadId`: `String` (Optional, if using LangGraph) - **Index (Sparse)**
    *   `userId`: `String` - **Index**
    *   `learningPlanId`: `ObjectId` (Ref `learning_plans._id`) - **Index**
    *   `exerciseDetails`: `Object` (Description of the specific exercise)
    *   `startedAt`: `Date`
    *   `completedAt`: `Date`
    *   `status`: `String` - **Index**
    *   `sessionTranscript`: `Array<Object>` (Or other structured session data)
    *   `score`: `Number` (Optional)
    *   `analysisId`: `ObjectId` (Optional, Ref `analyses._id`) - **Index**
*   **Indexes:** Allow finding practice sessions for a user or learning plan.

## Data Flow Summary

The application follows a cycle: User Preferences -> Interview (using `cases`) -> Save `interviews` -> Trigger Analysis -> Save `analyses` -> Trigger Learning Path -> Save `learning_plans`, Update `users` -> Trigger Practice -> Save `practice_sessions` -> Trigger Analysis -> Save `analyses` -> Trigger Learning Path/Orchestrator -> Loop or back to Interview.

This schema provides a decoupled, scalable foundation for this workflow.

**Note on Prompts:** The application uses different prompt templates (`prompt.ts`) based on the `caseType` and `interviewStyle` (for PEI) loaded from the `cases` collection to guide the interviewer agent's behavior appropriately.

The next step involves implementing the agent interactions and database operations within the application code.