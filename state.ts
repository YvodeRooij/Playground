import { Annotation, messagesStateReducer } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";

// Define the structure for the case study data (optional but good practice)
interface CaseStudyData {
    _id: string;
    title: string;
    problemStatement: string;
    // Add other fields if needed by the agents
    [key: string]: any; // Allow other properties
}

export const State = Annotation.Root({
    messages: Annotation<BaseMessage[]>({
        reducer: messagesStateReducer,
        default: () => []
    }),
    // Add a field to hold the case study object
    caseStudy: Annotation<CaseStudyData | null>({
        // Simple reducer: take the latest value provided for the case study
        reducer: (current, update) => update ?? current,
        default: () => null // Keep the default as null
    })
})

