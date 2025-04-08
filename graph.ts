import { ChatOpenAI } from "@langchain/openai";
import { StateGraph, START, END, MemorySaver } from "@langchain/langgraph";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { interviewerPrompt, candidatePrompt } from "./prompt";
import { v4 as uuidv4 } from 'uuid';
import { State } from "./state";
import dotenv from "dotenv";
dotenv.config();
import * as fs from 'fs/promises'; // TODO: Remove fs/promises if only using MongoDB
import path from 'path'; // TODO: Remove path if only using MongoDB and not saving files
// TODO: Add MongoDB driver import (e.g., import { MongoClient } from 'mongodb';)

// Initialize models - you can use the same model with different prompts
const model = new ChatOpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    model: "o3-mini"
});

// Create the graph
const builder = new StateGraph(State);

// Define the interviewer node - uses the model and interviewer prompt
async function interviewer(state: typeof State.State) {
    // Format the interviewer prompt with necessary info
    const interviewerMessages = await interviewerPrompt.formatMessages({ name: "Yvo" });
    // Combine the system prompt with the current conversation history
    const messages = [...interviewerMessages, ...state.messages];
    const answer = await model.invoke(messages);
    return { "messages": [answer] };
}

// Define the candidate node - also uses the model but with candidate prompt
async function candidate(state: typeof State.State) {

// TODO retreive user name from mongodb
//const user = await db.collection('users').findOne({ _id: userId });

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

// Compile with memory saver to maintain conversation context
let graph = builder.compile({
 
});

const main = async () => {
    // TODO: Establish MongoDB connection here
    // const client = new MongoClient(process.env.MONGODB_URI);
    // await client.connect();
    // const db = client.db("your_db_name");
    // const interviewsCollection = db.collection("interviews");
    // Start the conversation with an empty message list.
    // The interviewer node will add its system prompt first.
    const result = await graph.invoke({
        messages: []
    });
    
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
    const filename = `interview_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    // TODO: Remove file system specific directory creation if only using MongoDB
    const interviewsDir = path.join(process.cwd(), 'interviews');
    const filePath = path.join(interviewsDir, filename);
    
    // TODO: Remove directory creation if only using MongoDB
    await fs.mkdir(interviewsDir, { recursive: true });
    
    // TODO: Replace file writing with MongoDB insertion
    // Prepare the document for MongoDB
    const interviewDocument = {
        // _id will be generated by MongoDB automatically unless specified
        candidateName: "Yvo", // TODO: Make dynamic if needed
        timestamp: new Date(), // Use Date object for MongoDB
        conversation: finalConversationHistory
        // Add any other relevant fields
    };
    // await interviewsCollection.insertOne(interviewDocument);

    // Keep the file writing for now, or remove if switching completely
    await fs.writeFile(
        filePath,
        JSON.stringify({
            id: filename, // TODO: Consider using MongoDB ObjectId for _id instead of filename
            candidateName: "Yvo",
            timestamp: new Date().toISOString(),
            conversation: finalConversationHistory
        }, null, 2)
    );
    
    // TODO: Update log message for MongoDB success
    console.log(`\nInterview saved to ${filePath}`);
    // console.log(`\nInterview saved to MongoDB with ID: ${interviewDocument._id}`);

    // TODO: Close MongoDB connection gracefully at the end
    // await client.close();
};

main().catch(console.error);