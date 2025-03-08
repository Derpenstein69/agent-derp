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
import { Vectorize } from "vectorize"; // Import Vectorize

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
          try {
            result = await toolInstance(toolInvocation.args, {
              messages: convertToCoreMessages(messages),
              toolCallId: toolInvocation.toolCallId,
            });
          } catch (error) {
            console.error(`Error executing tool ${toolName}: ${error.message}`);
            result = `Error executing tool ${toolName}: ${error.message}`;
          }
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

/**
 * Retrieves the list of tools that require human confirmation before execution.
 *
 * @param tools - The set of tools to check
 * @returns An array of tool names that require confirmation
 */
export function getToolsRequiringConfirmation<
  T extends ToolSet
>(tools: T): string[] {
  return (Object.keys(tools) as (keyof T)[]).filter((key) => {
    const maybeTool = tools[key];
    return typeof maybeTool.execute !== "function";
  }) as string[];
}

// Helper functions for task categorization
/**
 * Categorizes a task based on its type, schedule, and payload.
 *
 * @param task - The task to categorize
 * @returns The categorized task with an optional category
 */
export function categorizeTask(task: { type: string; when: string | number; payload: string; category?: string }) {
  const vectorizedTask = Vectorize(task); // Use Vectorize for task categorization
  return {
    ...vectorizedTask,
    category: task.category || "Uncategorized",
  };
}

// Helper functions for task history management
/**
 * Adds a task to the task history.
 *
 * @param task - The task to add to history
 */
export function addTaskToHistory(task: { type: string; when: string | number; payload: string; category?: string }) {
  const history = getTaskHistory();
  history.push(task);
  localStorage.setItem("taskHistory", JSON.stringify(history));
}

/**
 * Retrieves the task history from local storage.
 *
 * @returns The task history as an array of tasks
 */
export function getTaskHistory() {
  const history = localStorage.getItem("taskHistory");
  return history ? JSON.parse(history) : [];
}

// Helper functions for task analytics
/**
 * Updates task analytics with the provided task information.
 *
 * @param task - The task to update analytics for
 */
export function updateTaskAnalytics(task: { type: string; when: string | number; payload: string; category?: string }) {
  const vectorizedTask = Vectorize(task); // Use Vectorize for task analytics
  const analytics = getTaskAnalytics();
  const category = vectorizedTask.category || "Uncategorized";
  if (!analytics[category]) {
    analytics[category] = { count: 0, tasks: [] };
  }
  analytics[category].count += 1;
  analytics[category].tasks.push(vectorizedTask);
  localStorage.setItem("taskAnalytics", JSON.stringify(analytics));
}

/**
 * Retrieves task analytics from local storage.
 *
 * @returns The task analytics as an object
 */
export function getTaskAnalytics() {
  const analytics = localStorage.getItem("taskAnalytics");
  return analytics ? JSON.parse(analytics) : {};
}

// Helper functions for task categorization and history management
/**
 * Categorizes a task and adds it to the task history.
 *
 * @param task - The task to categorize and add to history
 */
export function categorizeAndAddTaskToHistory(task: { type: string; when: string | number; payload: string; category?: string }) {
  const categorizedTask = categorizeTask(task);
  addTaskToHistory(categorizedTask);
}

// Helper functions for task analytics to generate insights into task performance
/**
 * Generates insights into task performance based on task analytics.
 *
 * @returns An array of task performance insights
 */
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
/**
 * Adjusts a task's schedule based on real-time data.
 *
 * @param taskId - The ID of the task to adjust
 * @param newSchedule - The new schedule for the task
 */
export function adjustTaskBasedOnRealTimeData(taskId: string, newSchedule: string | number) {
  const history = getTaskHistory();
  const taskIndex = history.findIndex((task: { id: string }) => task.id === taskId);
  if (taskIndex !== -1) {
    history[taskIndex].when = newSchedule;
    localStorage.setItem("taskHistory", JSON.stringify(history));
  }
}

// Helper functions for real-time task updates
/**
 * Updates the status of a task in real-time.
 *
 * @param taskId - The ID of the task to update
 * @param status - The new status of the task
 */
export function updateTaskStatusInRealTime(taskId: string, status: string) {
  const history = getTaskHistory();
  const taskIndex = history.findIndex((task: { id: string }) => task.id === taskId);
  if (taskIndex !== -1) {
    history[taskIndex].status = status;
    localStorage.setItem("taskHistory", JSON.stringify(history));
  }
}

// Helper functions to manage user profiles and contextual memory
/**
 * Creates a user profile with preferences and frequently asked questions.
 *
 * @param userId - The ID of the user
 * @param preferences - The user's preferences
 * @param frequentlyAskedQuestions - The user's frequently asked questions
 */
export function createUserProfile(userId: string, preferences: any, frequentlyAskedQuestions: any[]) {
  const userProfiles = getUserProfiles();
  userProfiles[userId] = { preferences, frequentlyAskedQuestions };
  localStorage.setItem("userProfiles", JSON.stringify(userProfiles));
}

/**
 * Retrieves user profiles from local storage.
 *
 * @returns The user profiles as an object
 */
export function getUserProfiles() {
  const profiles = localStorage.getItem("userProfiles");
  return profiles ? JSON.parse(profiles) : {};
}

/**
 * Updates a user profile with new preferences and frequently asked questions.
 *
 * @param userId - The ID of the user
 * @param newPreferences - The new preferences for the user
 * @param newFrequentlyAskedQuestions - The new frequently asked questions for the user
 */
export function updateUserProfile(userId: string, newPreferences: any, newFrequentlyAskedQuestions: any[]) {
  const userProfiles = getUserProfiles();
  if (userProfiles[userId]) {
    userProfiles[userId].preferences = newPreferences;
    userProfiles[userId].frequentlyAskedQuestions = newFrequentlyAskedQuestions;
    localStorage.setItem("userProfiles", JSON.stringify(userProfiles));
  }
}

/**
 * Updates the context of a user profile with new information.
 *
 * @param userId - The ID of the user
 * @param newInfo - The new information to update the context with
 */
export function updateContextWithNewInfo(userId: string, newInfo: any) {
  const userProfiles = getUserProfiles();
  if (userProfiles[userId]) {
    userProfiles[userId].context = newInfo;
    localStorage.setItem("userProfiles", JSON.stringify(userProfiles));
  }
}

// Add a method to update the AI model with the latest conversation context
/**
 * Updates the AI model with the latest conversation context.
 *
 * @param conversationContext - The latest conversation context
 */
export function updateAIModelContext(conversationContext: any) {
  // Logic to update the AI model with the latest conversation context
}

// Add a method to store the entire conversation history
/**
 * Stores the entire conversation history.
 *
 * @param conversationHistory - The conversation history to store
 */
export function storeConversationHistory(conversationHistory: any) {
  // Logic to store the entire conversation history
}

// Add a method to store task details and user preferences
/**
 * Stores task details and user preferences.
 *
 * @param taskDetails - The task details to store
 * @param userPreferences - The user preferences to store
 */
export function storeTaskDetails(taskDetails: any, userPreferences: any) {
  // Logic to store task details and user preferences
}

// Integrate task history and analytics functions into user profiling
/**
 * Integrates task history and analytics into user profiling.
 *
 * @param userId - The ID of the user
 * @param task - The task to integrate into user profiling
 */
export function integrateTaskHistoryAndAnalytics(userId: string, task: { type: string; when: string | number; payload: string; category?: string }) {
  addTaskToHistory(task);
  updateTaskAnalytics(task);
  updateUserProfile(userId, getUserProfiles()[userId].preferences, getUserProfiles()[userId].frequentlyAskedQuestions);
}

// Helper functions to manage user profiles and contextual memory
/**
 * Manages user profiles with preferences and frequently asked questions.
 *
 * @param userId - The ID of the user
 * @param preferences - The user's preferences
 * @param frequentlyAskedQuestions - The user's frequently asked questions
 */
export function manageUserProfiles(userId: string, preferences: any, frequentlyAskedQuestions: any[]) {
  const userProfiles = getUserProfiles();
  userProfiles[userId] = { preferences, frequentlyAskedQuestions };
  localStorage.setItem("userProfiles", JSON.stringify(userProfiles));
}

// Helper functions to update the AI model with the latest conversation context
/**
 * Updates the AI model with the latest conversation context.
 *
 * @param conversationContext - The latest conversation context
 */
export function updateAIModelWithContext(conversationContext: any) {
  // Logic to update the AI model with the latest conversation context
}

// Helper functions to store the entire conversation history
/**
 * Stores the entire conversation history.
 *
 * @param conversationHistory - The conversation history to store
 */
export function storeFullConversationHistory(conversationHistory: any) {
  // Logic to store the entire conversation history
}

// Add logic to update user profiles with new information as the conversation progresses
/**
 * Updates a user profile with new information as the conversation progresses.
 *
 * @param userId - The ID of the user
 * @param newInfo - The new information to update the profile with
 */
export function updateUserProfileWithNewInfo(userId: string, newInfo: any) {
  const userProfiles = getUserProfiles();
  if (userProfiles[userId]) {
    userProfiles[userId].context = newInfo;
    localStorage.setItem("userProfiles", JSON.stringify(userProfiles));
  }
}
