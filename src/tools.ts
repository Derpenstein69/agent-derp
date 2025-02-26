/**
 * Tool definitions for the AI chat agent
 * Tools can either require human confirmation or execute automatically
 */
import { tool } from "ai";
import { z } from "zod";
import { Vectorize } from "vectorize"; // Import Vectorize

import { agentContext } from "./server";
import { categorizeTask, addTaskToHistory, updateTaskAnalytics, updateUserProfileWithNewInfo } from "./utils";

/**
 * Weather information tool that requires human confirmation
 * When invoked, this will present a confirmation dialog to the user
 * The actual implementation is in the executions object below
 */
const getWeatherInformation = tool({
  description: "show the weather in a given city to the user",
  parameters: z.object({ city: z.string() }),
  // Omitting execute function makes this tool require human confirmation
});

/**
 * Local time tool that executes automatically
 * Since it includes an execute function, it will run without user confirmation
 * This is suitable for low-risk operations that don't need oversight
 */
const getLocalTime = tool({
  description: "get the local time for a specified location",
  parameters: z.object({ location: z.string() }),
  execute: async ({ location }) => {
    console.log(`Getting local time for ${location}`);
    return "10am";
  },
});

const scheduleTask = tool({
  description:
    "schedule a task to be executed at a later time. 'when' can be a date, a delay in seconds, or a cron pattern.",
  parameters: z.object({
    type: z.enum(["scheduled", "delayed", "cron"]),
    when: z.union([z.number(), z.string()]),
    payload: z.string(),
    category: z.string().optional(), // Task categorization
    userId: z.string(), // User ID for profile updates
  }),
  execute: async ({ type, when, payload, category, userId }) => {
    // we can now read the agent context from the ALS store
    const agent = agentContext.getStore();
    if (!agent) {
      throw new Error("No agent found");
    }
    try {
      agent.schedule(
        type === "scheduled"
          ? new Date(when) // scheduled
          : type === "delayed"
          ? when // delayed
          : when, // cron
        "executeTask",
        payload
      );
      // Add task to history
      addTaskToHistory(categorizeTask({ type, when, payload, category }));
      // Update task analytics
      updateTaskAnalytics(categorizeTask({ type, when, payload, category }));
      // Update user profile with new task information
      updateUserProfileWithNewInfo(userId, { type, when, payload, category });
    } catch (error) {
      console.error("error scheduling task", error);
      return `Error scheduling task: ${error}`;
    }
    return `Task scheduled for ${when}`;
  },
});

/**
 * Tool for automated task adjustments based on real-time data and user interactions
 */
const adjustTask = tool({
  description: "adjust a scheduled task based on real-time data and user interactions",
  parameters: z.object({
    taskId: z.string(),
    newSchedule: z.union([z.number(), z.string()]),
  }),
  execute: async ({ taskId, newSchedule }) => {
    const agent = agentContext.getStore();
    if (!agent) {
      throw new Error("No agent found");
    }
    try {
      await agent.adjustScheduledTask(taskId, newSchedule);
    } catch (error) {
      console.error("error adjusting task", error);
      return `Error adjusting task: ${error}`;
    }
    return `Task ${taskId} adjusted to new schedule: ${newSchedule}`;
  },
});

/**
 * Tool for task analytics to provide insights into task performance and user behavior
 */
const analyzeTask = tool({
  description: "analyze task performance and provide insights",
  parameters: z.object({
    taskId: z.string(),
  }),
  execute: async ({ taskId }) => {
    const agent = agentContext.getStore();
    if (!agent) {
      throw new Error("No agent found");
    }
    try {
      const insights = await agent.analyzeTaskPerformance(taskId);
      return insights;
    } catch (error) {
      console.error("error analyzing task", error);
      return `Error analyzing task: ${error}`;
    }
  },
});

/**
 * Export all available tools
 * These will be provided to the AI model to describe available capabilities
 */
export const tools = {
  getWeatherInformation,
  getLocalTime,
  scheduleTask,
  adjustTask,
  analyzeTask,
};

/**
 * Implementation of confirmation-required tools
 * This object contains the actual logic for tools that need human approval
 * Each function here corresponds to a tool above that doesn't have an execute function
 */
export const executions = {
  getWeatherInformation: async ({ city }: { city: string }) => {
    console.log(`Getting weather information for ${city}`);
    return `The weather in ${city} is sunny`;
  },
};
