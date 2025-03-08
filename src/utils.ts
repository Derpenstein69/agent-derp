import { formatDataStreamPart, type Message } from "@ai-sdk/ui-utils";
import {
  convertToCoreMessages,
  type DataStreamWriter,
  type ToolExecutionOptions,
  type ToolSet,
  createOpenAI,
  streamText,
} from "ai";
import { z } from "zod";
import { APPROVAL } from "./shared";

function isValidToolName<K extends PropertyKey, T extends object>(
  key: K,
  obj: T
): key is K & keyof T {
  return key in obj;
}

/**
 * Processes tool invocations where human input is required, executing tools when authorized.
 *
 * @param options - The function options
 * @param options.tools - Map of tool names to Tool instances that may expose execute functions
 * @param options.dataStream - Data stream for sending results back to the client
 * @param options.messages - Array of messages to process
 * @param executionFunctions - Map of tool names to execute functions
 * @returns Promise resolving to the processed messages
 */
export async function processToolCalls<
  Tools extends ToolSet,
  ExecutableTools extends {
    [Tool in keyof Tools as Tools[Tool] extends { execute: Function }
      ? never
      : Tool]: Tools[Tool];
  }
>({
  dataStream,
  messages,
  executions,
}: {
  tools: Tools; // used for type inference
  dataStream: DataStreamWriter;
  messages: Message[];
  executions: {
    [K in keyof Tools & keyof ExecutableTools]?: (
      args: z.infer<ExecutableTools[K]["parameters"]>,
      context: ToolExecutionOptions
    ) => Promise<any>;
  };
}): Promise<Message[]> {
  const lastMessage = messages[messages.length - 1];
  const parts = lastMessage.parts;
  if (!parts) return messages;

  const processedParts = await Promise.all(
    parts.map(async (part) => {
      // Only process tool invocations parts
      if (part.type !== "tool-invocation") return part;

      const { toolInvocation } = part;
      const toolName = toolInvocation.toolName;

      // Only continue if we have an execute function for the tool (meaning it requires confirmation) and it's in a 'result' state
      if (!(toolName in executions) || toolInvocation.state !== "result")
        return part;

      let result;

      if (toolInvocation.result === APPROVAL.YES) {
        // Get the tool and check if the tool has an execute function.
        if (
          !isValidToolName(toolName, executions) ||
          toolInvocation.state !== "result"
        ) {
          return part;
        }

        const toolInstance = executions[toolName];
        if (toolInstance) {
          result = await toolInstance(toolInvocation.args, {
            messages: convertToCoreMessages(messages),
            toolCallId: toolInvocation.toolCallId,
          });
        } else {
          result = "Error: No execute function found on tool";
        }
      } else if (toolInvocation.result === APPROVAL.NO) {
        result = "Error: User denied access to tool execution";
      } else {
        // For any unhandled responses, return the original part.
        return part;
      }

      // Forward updated tool result to the client.
      dataStream.write(
        formatDataStreamPart("tool_result", {
          toolCallId: toolInvocation.toolCallId,
          result,
        })
      );

      // Return updated toolInvocation with the actual result.
      return {
        ...part,
        toolInvocation: {
          ...toolInvocation,
          result,
        },
      };
    })
  );

  // Finally return the processed messages
  return [...messages.slice(0, -1), { ...lastMessage, parts: processedParts }];
}

export function getToolsRequiringConfirmation<
  T extends ToolSet
  // E extends {
  //   [K in keyof T as T[K] extends { execute: Function } ? never : K]: T[K];
  // },
>(tools: T): string[] {
  return (Object.keys(tools) as (keyof T)[]).filter((key) => {
    const maybeTool = tools[key];
    return typeof maybeTool.execute !== "function";
  }) as string[];
}

// Helper functions for task categorization
export function categorizeTask(task: { type: string; when: string | number; payload: string; category?: string }) {
  return {
    ...task,
    category: task.category || "Uncategorized",
  };
}

// Helper functions for task history management
export function addTaskToHistory(task: { type: string; when: string | number; payload: string; category?: string }) {
  const history = getTaskHistory();
  history.push(task);
  localStorage.setItem("taskHistory", JSON.stringify(history));
}

export function getTaskHistory() {
  const history = localStorage.getItem("taskHistory");
  return history ? JSON.parse(history) : [];
}

// Helper functions for task analytics
export function updateTaskAnalytics(task: { type: string; when: string | number; payload: string; category?: string }) {
  const analytics = getTaskAnalytics();
  const category = task.category || "Uncategorized";
  if (!analytics[category]) {
    analytics[category] = { count: 0, tasks: [] };
  }
  analytics[category].count += 1;
  analytics[category].tasks.push(task);
  localStorage.setItem("taskAnalytics", JSON.stringify(analytics));
}

export function getTaskAnalytics() {
  const analytics = localStorage.getItem("taskAnalytics");
  return analytics ? JSON.parse(analytics) : {};
}

// Helper functions for task categorization and history management
export function categorizeAndAddTaskToHistory(task: { type: string; when: string | number; payload: string; category?: string }) {
  const categorizedTask = categorizeTask(task);
  addTaskToHistory(categorizedTask);
}

// Helper functions for task analytics to generate insights into task performance
export function generateTaskPerformanceInsights() {
  const analytics = getTaskAnalytics();
  const insights = Object.keys(analytics).map(category => {
    const { count, tasks } = analytics[category];
    return {
      category,
      count,
      tasks,
    };
  });
  return insights;
}

// Helper functions for automated task adjustments based on real-time data and user interactions
export function adjustTaskBasedOnRealTimeData(taskId: string, newSchedule: string | number) {
  const history = getTaskHistory();
  const taskIndex = history.findIndex((task: { id: string }) => task.id === taskId);
  if (taskIndex !== -1) {
    history[taskIndex].when = newSchedule;
    localStorage.setItem("taskHistory", JSON.stringify(history));
  }
}

// Helper functions for real-time task updates
export function updateTaskStatusInRealTime(taskId: string, status: string) {
  const history = getTaskHistory();
  const taskIndex = history.findIndex((task: { id: string }) => task.id === taskId);
  if (taskIndex !== -1) {
    history[taskIndex].status = status;
    localStorage.setItem("taskHistory", JSON.stringify(history));
  }
}

// Helper functions to manage user profiles and contextual memory
export function createUserProfile(userId: string, preferences: any, frequentlyAskedQuestions: any[]) {
  const userProfiles = getUserProfiles();
  userProfiles[userId] = { preferences, frequentlyAskedQuestions };
  localStorage.setItem("userProfiles", JSON.stringify(userProfiles));
}

export function getUserProfiles() {
  const profiles = localStorage.getItem("userProfiles");
  return profiles ? JSON.parse(profiles) : {};
}

export function updateUserProfile(userId: string, newPreferences: any, newFrequentlyAskedQuestions: any[]) {
  const userProfiles = getUserProfiles();
  if (userProfiles[userId]) {
    userProfiles[userId].preferences = newPreferences;
    userProfiles[userId].frequentlyAskedQuestions = newFrequentlyAskedQuestions;
    localStorage.setItem("userProfiles", JSON.stringify(userProfiles));
  }
}

export function updateContextWithNewInfo(userId: string, newInfo: any) {
  const userProfiles = getUserProfiles();
  if (userProfiles[userId]) {
    userProfiles[userId].context = newInfo;
    localStorage.setItem("userProfiles", JSON.stringify(userProfiles));
  }
}

// Add a method to update the AI model with the latest conversation context
export function updateAIModelContext(conversationContext: any) {
  // Logic to update the AI model with the latest conversation context
}

// Add a method to store the entire conversation history
export function storeConversationHistory(conversationHistory: any) {
  // Logic to store the entire conversation history
}

// Add a method to store task details and user preferences
export function storeTaskDetails(taskDetails: any, userPreferences: any) {
  // Logic to store task details and user preferences
}

// Integrate task history and analytics functions into user profiling
export function integrateTaskHistoryAndAnalytics(userId: string, task: { type: string; when: string | number; payload: string; category?: string }) {
  addTaskToHistory(task);
  updateTaskAnalytics(task);
  updateUserProfile(userId, getUserProfiles()[userId].preferences, getUserProfiles()[userId].frequentlyAskedQuestions);
}
