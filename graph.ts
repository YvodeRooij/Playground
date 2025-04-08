import { ChatOpenAI } from "@langchain/openai";
import { StateGraph, START, END, MemorySaver } from "@langchain/langgraph";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { interviewerPrompt, candidatePrompt } from "./prompt";
import { v4 as uuidv4 } from 'uuid';
import { State } from "./state";
import dotenv from "dotenv";
dotenv.config();

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
    // Start the conversation with an empty message list.
    // The interviewer node will add its system prompt first.
    const result = await graph.invoke({
        messages: []
    });
    
    // Print the final conversation
    console.log("\n===== FULL INTERVIEW TRANSCRIPT =====\n");
    // Filter out system messages first
    const conversationMessages = result.messages.filter(m => m._getType() !== 'system');

    // Iterate through the conversation messages and assign roles based on order
    conversationMessages.forEach((message, index) => {
        // Even index = Interviewer, Odd index = Candidate
        const role = index % 2 === 0 ? "INTERVIEWER" : "CANDIDATE";
        console.log(`${role}: ${message.content}`);
        console.log(); // Empty line for readability
    });
};

main().catch(console.error);