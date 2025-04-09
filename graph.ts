import { ChatOpenAI } from "@langchain/openai";
import { StateGraph, START, END, MemorySaver } from "@langchain/langgraph";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { interviewerPrompt, candidatePrompt } from "./prompt";
import { v4 as uuidv4 } from 'uuid';
import { State } from "./state";
import dotenv from "dotenv";
dotenv.config();
import * as fs from 'fs/promises'; // Using fs/promises for loading case files and saving results
import path from 'path'; // Using path for constructing file paths
// TODO (DB): Add MongoDB driver import (e.g., import { MongoClient, Db, ObjectId } from 'mongodb';)

// Define the structure for the case study data (matching state.ts is ideal)
interface CaseStudyData {
    _id: string; // Or ObjectId if fetched from MongoDB directly
    caseId: string; // Add caseId field for easier reference and consistency
    title: string;
    problemStatement: string;
    // Add other fields as needed from the case JSON structure
    dataPoints?: any;
    contextForTheCase?: any;
    interviewerHints?: any;
    [key: string]: any; // Allow other properties
}

// Initialize models - you can use the same model with different prompts
const model = new ChatOpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    model: "o3-mini"
});

// Create the graph
const builder = new StateGraph(State);

// Define the interviewer node - uses the model and interviewer prompt
// TODO (DB): Consider if nodes need direct DB access or if all data should flow via state from main(). Passing state is generally preferred.
async function interviewer(state: typeof State.State) {
    if (!state.caseStudy) {
         throw new Error("Case study data is missing from the state.");
    }
    // Format the interviewer prompt with name and case problem statement
    const interviewerMessages = await interviewerPrompt.formatMessages({
        name: "Yvo", // TODO: Make dynamic
        case_problem_statement: state.caseStudy.problemStatement
    });
    const messages = [...interviewerMessages, ...state.messages];
    const answer = await model.invoke(messages);
    return { "messages": [answer] };
}

// Define the candidate node - also uses the model but with candidate prompt
// TODO (DB): Consider if nodes need direct DB access or if all data should flow via state from main().
async function candidate(state: typeof State.State) {

    // TODO (Simulate DB): Retrieve dynamic user info (name, background) passed via initial state from main().
    // Example: const name = state.userName ?? "Candidate";
    // Example: const background = state.userBackground ?? "a relevant background";
    // Format the candidate prompt with necessary info


    const candidateMessages = await candidatePrompt.formatMessages({
        name: "Yvo",
        background: "Business Analytics with 3 years experience in data-driven strategy"
    });
    // Combine the system prompt with the current conversation history
    const messages = [...candidateMessages, ...state.messages];
    const answer = await model.invoke(messages);
    return { "messages": [answer] };
}

// Add nodes to the graph
builder
    .addNode("interviewer", interviewer)
    .addNode("candidate", candidate)
    .addEdge(START, "interviewer")
    .addEdge("interviewer", "candidate") // Interviewer always passes to candidate
    .addConditionalEdges(
        "candidate",
        // Candidate transitions back to interviewer if less than 6 turns (12 messages total) have occurred, otherwise ends
        (state) => state.messages.filter(m => m._getType() !== 'system').length < 12 ? "interviewer" : END,
        {
            "interviewer": "interviewer",
            [END]: END
        }
    );

// Instantiate an in-memory checkpointer.
// This allows the graph state to be saved at each step.
// For production, you might use a persistent checkpointer (e.g., SqliteSaver, RedisSaver, or a custom one).
const memory = new MemorySaver(); // TODO: Replace MemorySaver with a persistent checkpointer (e.g., using MongoDB) for production use cases.

// Compile the graph with the checkpointer.
// The checkpointer is responsible for saving and loading the state of the graph,
// enabling persistence and resumption of graph executions.
let graph = builder.compile({
    checkpointer: memory,
});

const main = async (userId: string = "user_placeholder_id", requestedCaseId?: string) => { // TODO: Pass actual userId and potentially a requested caseId
    // TODO (DB): Establish MongoDB connection
    // const client = new MongoClient(process.env.MONGODB_URI || "mongodb://localhost:27017");
    // await client.connect();
    // const db: Db = client.db("interview_simulator_db"); // TODO: Use actual DB name
    // const usersCollection = db.collection("users");
    // const casesCollection = db.collection<CaseStudyData>("cases");
    // const interviewsCollection = db.collection("interviews");
    // const analysesCollection = db.collection("analyses");
    // const learningPlansCollection = db.collection("learning_plans");
    // const practiceSessionsCollection = db.collection("practice_sessions");
    console.log("--- MongoDB Connection Placeholder ---"); // Placeholder
    // Define a unique identifier for this conversation thread.
    // Checkpointers use this ID to store and retrieve the state for a specific execution flow.
    // This allows multiple independent conversations to run concurrently using the same graph definition.
    const threadId = uuidv4(); // Generate a unique ID for this run
    const config = { configurable: { thread_id: threadId } };

    // --- Load User Data ---
    // TODO (DB): Fetch user data from `users` collection using userId.
    // const user = await usersCollection.findOne({ userId: userId });
    // if (!user) { console.error("User not found"); /* await client.close(); */ return; }
    // TODO (DB): Fetch completed case IDs by querying `interviews` or `analyses` for this user, or potentially from a (less scalable) embedded list in `user`.
    // Example (Querying interviews): const completedInterviews = await interviewsCollection.find({ userId: userId, status: "Completed" }).project({ caseId: 1 }).toArray();
    // Example (Querying analyses): const completedAnalyses = await analysesCollection.find({ userId: userId, sourceType: "interview" }).project({ caseId: 1 }).toArray();
    // const completedCaseIds = [...new Set(completedInterviews.map(i => i.caseId))]; // Get unique case IDs
    console.log(`--- User Data Placeholder for ${userId} ---`); // Placeholder
    const completedCaseIds: string[] = []; // Placeholder

    // --- Select and Load Case Study ---
    let caseData: CaseStudyData | null = null; // Initialize as null
    let caseId: string | undefined = requestedCaseId;

    // TODO (DB): Implement logic to select an appropriate case from `cases` collection using MongoDB.
    // 1. Build query filter: Consider user preferences (e.g., `user.preferences.selectedFirm`), difficulty, etc.
    // 2. Add `caseId: { $nin: completedCaseIds }` to the query filter to exclude completed cases.
    // 3. If `requestedCaseId` is provided and not completed, prioritize fetching that specific case: `query.caseId = requestedCaseId`.
    // 4. Fetch one matching case: `caseData = await casesCollection.findOne(query);`
    // 5. Handle case where no suitable case is found.
    // Example query:
    // const query: Filter<CaseStudyData> = {
    //     company: user.preferences.selectedFirm || "McKinsey", // Example preference
    //     caseId: { $nin: completedCaseIds }
    // };
    // if (requestedCaseId && !completedCaseIds.includes(requestedCaseId)) {
    //     query.caseId = requestedCaseId;
    // }
    // caseData = await casesCollection.findOne(query);

    // --- Fallback to file system loading (TEMPORARY SIMULATION) ---
    if (!caseData) {
        console.warn("MongoDB case fetching not implemented or failed, falling back to file system simulation.");

        // Simulate fetching user data (including completed cases) from file
        let userProfile: any; // Use 'any' for simplicity in simulation
        let userCompletedCaseIds: string[] = [];
        const userProfilePath = path.join(process.cwd(), 'user_profiles', `${userId}.json`);
        try {
            const profileContent = await fs.readFile(userProfilePath, 'utf-8');
            userProfile = JSON.parse(profileContent);
            userCompletedCaseIds = userProfile?.completedCaseIds || [];
            console.log(`Simulated loading user profile for ${userId}. Completed cases: ${userCompletedCaseIds.join(', ') || 'None'}`);
        } catch (error) {
            console.error(`Failed to load user profile file from ${userProfilePath}:`, error);
            // If profile doesn't exist, treat as new user with no completed cases
        }

        // Simulate finding an uncompleted case from the 'created_cases' directory
        const casesDir = path.join(process.cwd(), 'created_cases');
        let availableCaseFiles: string[] = [];
        try {
            availableCaseFiles = await fs.readdir(casesDir);
        } catch (error) {
             console.error(`Failed to read created_cases directory at ${casesDir}:`, error);
             // await client.close(); // TODO (DB): Uncomment when DB connection is live
             return; // Cannot proceed without cases
        }

        let selectedCaseFile: string | undefined = undefined;
        let potentialCaseId: string | undefined = undefined;

        // Prioritize requestedCaseId if provided and not completed
        if (requestedCaseId && !userCompletedCaseIds.includes(requestedCaseId)) {
             const requestedFileName = `${requestedCaseId}.json`;
             if (availableCaseFiles.includes(requestedFileName)) {
                 selectedCaseFile = requestedFileName;
                 potentialCaseId = requestedCaseId;
                 console.log(`Attempting to load requested case: ${selectedCaseFile}`);
             } else {
                 console.warn(`Requested case file ${requestedFileName} not found in ${casesDir}.`);
             }
        }

        // If no specific case requested or request failed, find the first available uncompleted case
        if (!selectedCaseFile) {
            for (const fileName of availableCaseFiles) {
                if (fileName.endsWith('.json')) {
                    const caseIdFromFile = fileName.replace('.json', '');
                    if (!userCompletedCaseIds.includes(caseIdFromFile)) {
                        selectedCaseFile = fileName;
                        potentialCaseId = caseIdFromFile;
                        console.log(`Found available uncompleted case: ${selectedCaseFile}`);
                        break; // Select the first one found
                    }
                }
            }
        }


        if (!selectedCaseFile || !potentialCaseId) {
            console.error(`User ${userId} has completed all available cases, or no suitable cases found.`);
            // await client.close(); // TODO (DB): Uncomment when DB connection is live
            return; // Exit if no suitable case found
        }

        // Load the selected case file
        caseId = potentialCaseId; // Set the final caseId
        const casePath = path.join(casesDir, selectedCaseFile);
        try {
            const caseContent = await fs.readFile(casePath, 'utf-8');
            caseData = JSON.parse(caseContent) as CaseStudyData;
            // Ensure caseId field exists in the loaded data
            if (caseData && !caseData.caseId) {
                caseData.caseId = caseId;
            }
            console.log(`Loaded case study from file: ${caseData?.title} (ID: ${caseId})`);
        } catch (error) {
            console.error(`Failed to load selected case study from ${casePath}:`, error);
            // await client.close(); // TODO (DB): Uncomment when DB connection is live
            return; // Exit if case loading fails
        }
    }
    // --- End Fallback ---
    // else { // Keep the problematic else block commented out
    //      // This block executes if caseData was potentially loaded from DB (currently placeholder)
    //      // Persistent TS 'type never' errors occurred within this block, even with guards.
    //      // Commenting out entirely until DB logic is implemented and the type issue resolved.
    //
    //      // Placeholder logic for when DB fetch works but TS analysis fails:
    //      // console.log("--- Case data loaded from DB (Placeholder Log) ---");
    //      // Still attempt to assign caseId if caseData is truthy (which it should be here)
    //      // if (caseData) {
    //      //     // Using non-null assertion (!) as TS seems confused about the type here
    //      //     caseId = caseData!.caseId;
    //      // }
    // }
    // --- End Select and Load Case Study ---

    // Check if caseData is loaded successfully before proceeding
    if (!caseData || !caseId) {
        console.error("Could not load or select a case study.");
        // await client.close(); // TODO: Uncomment when DB connection is live
        return;
    }

    // Start the conversation with the loaded case data in the initial state
    const initialState = {
        messages: [],
        caseStudy: caseData, // Pass the loaded data here
        // TODO (Simulate DB): Pass necessary user info (name, background) into state if needed by nodes.
        // userName: user?.name,
        // userBackground: user?.background,
    };
    const result = await graph.invoke(initialState, config);
    
    // Extract and format the messages for saving
    const conversationHistory = result.messages.map(message => {
        // Determine the role based on message type
        let role;
        if (message._getType() === "system") {
            // Skip system messages for the final log, or label them if needed
            // For now, let's skip them in the final JSON as they are setup instructions
            return null;
        } else if (message._getType() === "ai") {
             // Assuming the first AI message is Interviewer, second is Candidate, etc.
             // Need to determine based on position *after* filtering system messages
             // Let's refine this logic slightly based on the previous implementation
             role = "UNKNOWN"; // Placeholder, will determine below
        } else if (message._getType() === "human") { // Assuming human messages are candidate responses if any
             role = "CANDIDATE";
        } else {
             role = "UNKNOWN";
        }
        
        return {
            role, // Role will be assigned properly below
            content: message.content,
            timestamp: new Date().toISOString() // Add timestamp per message
        };
    }).filter(msg => msg !== null); // Remove null entries from skipped system messages

    // Assign roles based on alternating turns after filtering system messages
    let turnCounter = 0;
    const finalConversationHistory = conversationHistory.map(msg => {
        if (msg.role === "UNKNOWN") { // Only assign roles to AI messages here
             msg.role = turnCounter % 2 === 0 ? "INTERVIEWER" : "CANDIDATE";
             turnCounter++;
        }
        return msg;
    });

    // Create a filename with timestamp
    // Modify the final saved object
    const filename = `interview_${caseId}_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    const interviewsDir = path.join(process.cwd(), 'interviews');
    const filePath = path.join(interviewsDir, filename);
    await fs.mkdir(interviewsDir, { recursive: true });

    const finalOutput = {
        // Use caseId or title for better identification
        interviewId: threadId, // Use threadId as unique interview ID
        caseStudyId: caseData.caseId, // Use caseId consistently
        caseStudyTitle: caseData.title,
        // TODO (Simulate DB): Use actual user name from fetched/simulated user data
        candidateName: /* user?.name ?? */ "Yvo", // Placeholder
        timestamp: new Date().toISOString(),
        conversation: finalConversationHistory // Assuming finalConversationHistory is correctly generated
    };

    // --- Save Interview Transcript ---
    // TODO (DB): Save transcript to `interviews` collection in MongoDB.
    // const interviewDocument = {
    //     threadId: threadId,
    //     userId: userId,
    //     caseId: caseId, // Use the actual caseId used
    //     startedAt: new Date(initialState.messages[0]?.timestamp || Date.now()), // Approx start time
    //     completedAt: new Date(),
    //     status: "Completed", // Assuming completion if this point is reached
    //     caseStudyTitle: caseData.title, // Denormalized for convenience
    //     candidateName: finalOutput.candidateName, // Use name from finalOutput
    //     conversation: finalConversationHistory
    // };
    // const insertResult = await interviewsCollection.insertOne(interviewDocument);
    // const interviewId = insertResult.insertedId;
    // console.log(`\nInterview saved to MongoDB with ID: ${interviewId}`);
    // TODO (Workflow): Trigger Analysis Agent (pass interviewId)

    // Keep file writing for now, or remove if switching completely
    await fs.writeFile(filePath, JSON.stringify(finalOutput, null, 2));
    console.log(`\nInterview using case '${caseData.title}' saved to ${filePath}`);
    // --- End Save Interview Transcript ---

    // --- Update User Progress (Simulated - NOT SCALABLE) ---
    // TODO (Simulate DB): Update user progress file.
    // **WARNING:** This file-based update is for simulation ONLY. It's NOT scalable and prone to race conditions in a real multi-user environment.
    // The actual DB implementation (TODO below) should use atomic database operations.
    const userProfilePath = path.join(process.cwd(), 'user_profiles', `${userId}.json`); // Re-define path for clarity
    try {
        // Re-read the profile just before writing to minimize (but not eliminate) race conditions
        let profileToUpdate: any;
        try {
             const profileContent = await fs.readFile(userProfilePath, 'utf-8');
             profileToUpdate = JSON.parse(profileContent);
        } catch (readError) {
             console.error(`Error reading profile ${userProfilePath} for update, creating new?`, readError);
             // If profile didn't exist initially, maybe create it here? For now, log error.
             profileToUpdate = { userId: userId, completedCaseIds: [] }; // Basic structure if creating
        }

        if (profileToUpdate && caseId) {
            profileToUpdate.completedCaseIds = [...new Set([...(profileToUpdate.completedCaseIds || []), caseId])]; // Add unique caseId
            await fs.writeFile(userProfilePath, JSON.stringify(profileToUpdate, null, 2));
            console.log(`Simulated update to ${userProfilePath}, added completed case ${caseId}`);
        }
    } catch (error) {
        console.error(`Simulated user profile update failed for ${userProfilePath}:`, error);
    }
    // TODO (DB): Replace above simulation with atomic MongoDB update.
    // Example:
    // await usersCollection.updateOne(
    //     { userId: userId },
    //     { $addToSet: { completedCases: { caseId: caseId!, completedAt: new Date() } } } // Or update separate collection
    // );
    // console.log(`User ${userId} progress updated in DB for case ${caseId}`);
    // console.log(`\nInterview saved to MongoDB with ID: ${interviewDocument._id}`);

    // --- Close DB Connection ---
    // TODO (DB): Close MongoDB connection gracefully
    // await client.close();
    console.log("--- MongoDB Connection Close Placeholder ---"); // Placeholder
};

// TODO (Simulate DB): Call main with actual userId, e.g., from command line args or environment variable
main("user123").catch(console.error);