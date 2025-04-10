import { ChatOpenAI } from "@langchain/openai";
import { StateGraph, START, END, MemorySaver } from "@langchain/langgraph";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatPromptTemplate } from "@langchain/core/prompts"; // Import ChatPromptTemplate type
import { interviewerPrompt, candidatePrompt, peiInterviewerLedPrompt, peiCandidateLedPrompt } from "./prompt"; // Import standard, PEI-Led, and PEI-Candidate prompts
import { v4 as uuidv4 } from 'uuid';
import { State } from "./state";
import dotenv from "dotenv";
dotenv.config();
// Unused file system imports (fs, path) removed.
import { MongoClient, Db, ObjectId, Collection, Filter } from 'mongodb'; // MongoDB Driver Imports
import { MONGODB_URI, DATABASE_NAME } from './config'; // Import DB config
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
// Note: Nodes currently don't access DB directly; data flows via state from main().
async function interviewer(state: typeof State.State) {
    if (!state.caseStudy) {
        throw new Error("Case study data is missing from the state.");
    }

    let promptToUse: ChatPromptTemplate; // Add type annotation
    let promptArgs: Record<string, any> = { name: "Yvo" /* TODO: Make dynamic */ };

    // Check the type of case loaded
    if (state.caseStudy.caseType === "PEI") {
        const firmName = state.caseStudy.company || "the firm"; // Get firm name from case data
        promptArgs.firm_name = firmName;
        promptArgs.pei_structure = JSON.stringify({ // Pass structure
            focusAreas: state.caseStudy.focusAreas,
            guidance: state.caseStudy.interviewerGuidance
        }, null, 2);

        // Select prompt based on interview style defined in the PEI case file
        if (state.caseStudy.interviewStyle === "candidate-led") {
            console.log(`Using PEI Candidate-Led Prompt for ${firmName}`);
            promptToUse = peiCandidateLedPrompt;
        } else { // Default to interviewer-led
            console.log(`Using PEI Interviewer-Led Prompt for ${firmName}`);
            promptToUse = peiInterviewerLedPrompt;
        }
    } else {
        console.log("Using Standard Case Interviewer Prompt");
        promptToUse = interviewerPrompt;
        promptArgs.case_problem_statement = state.caseStudy.problemStatement;
    }

    // Format the chosen prompt
    const interviewerMessages = await promptToUse.formatMessages(promptArgs);

    // Combine system messages with conversation history
    const messages = [...interviewerMessages, ...state.messages];
    const answer = await model.invoke(messages);
    return { "messages": [answer] };
}

// Define the candidate node - also uses the model but with candidate prompt
// Note: Nodes currently don't access DB directly.
async function candidate(state: typeof State.State) {

    // TODO: Retrieve dynamic user info (e.g., user.name, user.background) from the loaded 'user' object in main()
    //       and potentially pass it via the initial graph state if needed by nodes directly.
    // Format the candidate prompt with necessary info (currently hardcoded using "Yvo")


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
const memory = new MemorySaver(); // Using in-memory checkpointer for now.

// Compile the graph with the checkpointer.
// The checkpointer is responsible for saving and loading the state of the graph,
// enabling persistence and resumption of graph executions.
let graph = builder.compile({
    checkpointer: memory,
});

const main = async (userId: string = "user_placeholder_id", requestedCaseId?: string) => { // TODO: Pass actual userId

    // --- MongoDB Connection Setup ---
    let client: MongoClient | null = null; // Initialize client as null
    let db: Db;
    let usersCollection: Collection;
    let casesCollection: Collection<CaseStudyData>; // Use CaseStudyData type
    let interviewsCollection: Collection;
    // Define other collections if needed later (analyses, learning_plans, practice_sessions)

    try {
        client = new MongoClient(MONGODB_URI);
        await client.connect();
        db = client.db(DATABASE_NAME);
        usersCollection = db.collection("users");
        casesCollection = db.collection<CaseStudyData>("cases");
        interviewsCollection = db.collection("interviews");
        console.log(`--- Successfully connected to MongoDB: ${DATABASE_NAME} ---`);
    // Define a unique identifier for this conversation thread.
    // Checkpointers use this ID to store and retrieve the state for a specific execution flow.
    // This allows multiple independent conversations to run concurrently using the same graph definition.

        // Define a unique identifier for this conversation thread.
        // Checkpointers use this ID to store and retrieve the state for a specific execution flow.
        // This allows multiple independent conversations to run concurrently using the same graph definition.
        const threadId = uuidv4(); // Generate a unique ID for this run
        const config = { configurable: { thread_id: threadId } };

        // --- Load User Data ---
        console.log(`Attempting to load user data for userId: ${userId}`);
        const user = await usersCollection.findOne({ _id: new ObjectId(userId) }); // Find by ObjectId

        if (!user) {
            console.error(`User not found with userId: ${userId}`);
            // Optionally create a new user entry here or handle as an error
            return; // Exit if user not found
        }
        console.log(`User data loaded successfully for ${user.name || userId}`);

        // Extract preferences and progress
        const selectedFirm: string | undefined = user.preferences?.selectedFirm?.toLowerCase();
        const firmProgress = (selectedFirm && user.progress?.[selectedFirm])
            ? user.progress[selectedFirm]
            : { peiCompleted: false, completedCaseIds: [] }; // Default if no firm or progress for firm

        const completedCaseIds: string[] = firmProgress.completedCaseIds || []; // Get completed IDs from user doc

        console.log(`Selected Firm: ${selectedFirm || 'None'}. PEI Completed: ${firmProgress.peiCompleted}. Completed Cases: ${completedCaseIds.join(', ') || 'None'}`);

        if (!selectedFirm) {
            console.error("User has no selected firm in profile. Cannot select a case.");
            return;
        }

        // --- Select and Load Case Study ---
        let caseData: CaseStudyData | null = null; // Initialize as null
        let caseId: string | undefined = undefined; // Initialize caseId as undefined
        let query: Filter<CaseStudyData> = {}; // Initialize query object

        console.log("Selecting case study from MongoDB...");

        // Prioritize requestedCaseId if provided and not completed
        if (requestedCaseId && !completedCaseIds.includes(requestedCaseId)) {
            console.log(`Attempting to load requested case: ${requestedCaseId}`);
            query = { caseId: requestedCaseId, company: selectedFirm }; // Ensure it matches the firm too
            caseData = await casesCollection.findOne(query);
            if (caseData) {
                console.log(`Successfully loaded requested case: ${caseData.title}`);
                caseId = caseData.caseId; // Set caseId from loaded data
            } else {
                console.warn(`Requested case ${requestedCaseId} not found or doesn't match selected firm ${selectedFirm}. Proceeding with standard selection.`);
            }
        }

        // If no specific case requested or found, proceed with PEI/Standard logic
        if (!caseData) {
            if (!firmProgress.peiCompleted) {
                // --- Select PEI Case ---
                const peiCaseId = `pei_standard_${selectedFirm}_2025`;
                console.log(`PEI not completed for ${selectedFirm}. Attempting to load PEI case: ${peiCaseId}`);
                query = { caseId: peiCaseId, company: { $regex: `^${selectedFirm}$`, $options: 'i' } }; // Case-insensitive company match
                caseData = await casesCollection.findOne(query);
                if (caseData) {
                    console.log(`Found PEI case: ${caseData.title}`);
                    caseId = caseData.caseId;
                } else {
                    console.warn(`PEI case ${peiCaseId} not found for firm ${selectedFirm}. Marking PEI as 'skipped' for this session and attempting standard case.`);
                    // Mark PEI as completed in memory for this session to select a standard case next
                    firmProgress.peiCompleted = true;
                    // Note: We don't update the DB here, only if the interview completes successfully later.
                }
            }

            // --- Select Standard Case (if PEI completed or PEI not found) ---
            if (firmProgress.peiCompleted && !caseData) {
                console.log(`PEI completed or skipped for ${selectedFirm}. Selecting standard case...`);
                query = {
                    company: { $regex: `^${selectedFirm}$`, $options: 'i' }, // Case-insensitive match
                    caseType: { $ne: 'PEI' }, // Exclude PEI cases
                    caseId: { $nin: completedCaseIds } // Exclude already completed cases
                };
                // Find one standard case matching the criteria
                // Optional: Add sorting logic here if needed (e.g., by difficulty, creation date)
                caseData = await casesCollection.findOne(query);
                if (caseData) {
                    console.log(`Found available standard case: ${caseData.title}`);
                    caseId = caseData.caseId;
                } else {
                    console.error(`User ${userId} has completed all available standard cases for ${selectedFirm}, or no suitable standard cases found.`);
                    // No case found, return or throw error
                    return;
                }
            }
        }
        // --- End MongoDB Case Selection ---
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
        // Connection is closed in the finally block
        return;
    }
// Log the type of interview starting (ONCE before invoking)
if (caseData.caseType === "PEI") {
    const firmName = caseData.company || "the firm";
    const style = caseData.interviewStyle === "candidate-led" ? "Candidate-Led" : "Interviewer-Led";
    console.log(`\nStarting PEI (${style}) for ${firmName} with case ID: ${caseId}`);
} else {
    console.log(`\nStarting Standard Case Interview with case ID: ${caseId}`);
}

// Log the type of interview starting (ONCE before invoking)
if (caseData.caseType === "PEI") {
    const firmName = caseData.company || "the firm";
    const style = caseData.interviewStyle === "candidate-led" ? "Candidate-Led" : "Interviewer-Led";
    console.log(`\nStarting PEI (${style}) for ${firmName} with case ID: ${caseId}`);
} else {
    console.log(`\nStarting Standard Case Interview with case ID: ${caseId}`);
}

// Start the conversation with the loaded case data in the initial state
const initialState = {
    messages: [],
    caseStudy: caseData, // Pass the loaded data here
    // TODO: Pass necessary user info (e.g., user.name, user.background) into the initial state
    //       if nodes like 'candidate' or 'interviewer' need direct access to it.
    // userName: user?.name, // Example
    // userBackground: user?.background, // Example
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


    const finalOutput = {
        // Use caseId or title for better identification
        interviewId: threadId, // Use threadId as unique interview ID
        caseStudyId: caseData.caseId, // Use caseId consistently
        caseStudyTitle: caseData.title,
        // User name is now taken from the loaded 'user' object
        candidateName: user?.name ?? "Unknown Candidate", // Use actual user name if available
        timestamp: new Date().toISOString(),
        conversation: finalConversationHistory // Assuming finalConversationHistory is correctly generated
    };

        // --- Save Interview Transcript to MongoDB ---
        const interviewDocument = {
            threadId: threadId,
            userId: userId,
            caseId: caseId, // Use the actual caseId used
            // Estimate start time - might need refinement if precise start is needed
            startedAt: new Date(Date.now() - (result.messages.length * 10000)), // Rough estimate
            completedAt: new Date(),
            status: "Completed", // Assuming completion if this point is reached
            caseStudyTitle: caseData.title, // Denormalized for convenience
            candidateName: finalOutput.candidateName, // Use name from finalOutput
            conversation: finalConversationHistory
        };
        const insertResult = await interviewsCollection.insertOne(interviewDocument);
        const interviewMongoId = insertResult.insertedId;
        console.log(`\nInterview transcript saved to MongoDB with _id: ${interviewMongoId}`);
        // TODO (Next Step): Trigger Analysis Agent (pass interviewMongoId or threadId)
        // --- End Save Interview Transcript ---

        // --- Update User Progress in MongoDB ---
        if (selectedFirm && caseId && caseData) {
            try {
                let updateOperation;
                if (caseData.caseType === "PEI") {
                    updateOperation = { $set: { [`progress.${selectedFirm}.peiCompleted`]: true } };
                    console.log(`Updating user ${userId}: Setting PEI completed for firm ${selectedFirm}.`);
                } else {
                    updateOperation = { $addToSet: { [`progress.${selectedFirm}.completedCaseIds`]: caseId } };
                    console.log(`Updating user ${userId}: Adding standard case ${caseId} to completed list for firm ${selectedFirm}.`);
                }

                const updateResult = await usersCollection.updateOne({ _id: new ObjectId(userId) }, updateOperation); // Find by ObjectId for update

                if (updateResult.modifiedCount > 0 || updateResult.upsertedCount > 0 || updateResult.matchedCount > 0) {
                    console.log(`Successfully updated progress for user ${userId}.`);
                } else {
                    // This might happen if the document exists but the value was already set (e.g., PEI already true, caseId already in array)
                    console.log(`User progress for ${userId} already up-to-date or user not found for update (though user was loaded earlier).`);
                }
            } catch (updateError) {
                console.error(`Failed to update user progress in MongoDB for user ${userId}:`, updateError);
                // Decide if this error should halt the process or just be logged
            }
        } else {
            console.warn("Skipping user progress update - missing selectedFirm, caseId, or caseData.");
        }
        // --- End Update User Progress ---



    } catch (error) {
        console.error("An error occurred during the interview process:", error);
        // Handle specific errors if needed
    } finally {
        // --- Close DB Connection ---
        if (client) {
            await client.close();
            console.log("--- MongoDB Connection Closed ---");
        }
    }
};

// TODO: Pass actual userId to main() dynamically (e.g., from auth, command line args) instead of hardcoding "user123".
main("676d95c23fdf0b5f5b7c8254").catch(console.error);