import {
  type AgentNamespace,
  type Connection,
  routeAgentRequest,
  type Agent,
  type Schedule,
} from "agents-sdk";
import { AIChatAgent } from "agents-sdk/ai-chat-agent";
import {
  createDataStreamResponse,
  generateId,
  type Message,
  streamText,
  type StreamTextOnFinishCallback,
} from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { processToolCalls } from "./utils";
import { tools, executions } from "./tools";
import { AsyncLocalStorage } from "node:async_hooks";

// Environment variables type definition
export type Env = {
  OPENAI_API_KEY: string;
  Chat: AgentNamespace<Chat>;
  GATEWAY_BASE_URL: string;
};

// we use ALS to expose the agent context to the tools
export const agentContext = new AsyncLocalStorage<Chat>();
/**
 * Chat Agent implementation that handles real-time AI chat interactions
 */
export class Chat extends AIChatAgent<Env> {
  conversationHistory: Message[] = [];
  taskHistory: { id: string; type: string; when: string | number; payload: string; category?: string }[] = [];
  userProfiles: { [userId: string]: { preferences: any; frequentlyAskedQuestions: any[] } } = {};

  /**
   * Handles incoming chat messages and manages the response stream
   * @param onFinish - Callback function executed when streaming completes
   */
  async onChatMessage(onFinish: StreamTextOnFinishCallback<any>) {
    // Create a streaming response that handles both text and tool outputs
    return agentContext.run(this, async () => {
      const dataStreamResponse = createDataStreamResponse({
        execute: async (dataStream) => {
          // Process any pending tool calls from previous messages
          // This handles human-in-the-loop confirmations for tools
          const processedMessages = await processToolCalls({
            messages: this.messages,
            dataStream,
            tools,
            executions,
          });

          // Update conversation history
          this.conversationHistory.push(...processedMessages);

          // Initialize Workers AI client with AI binding from environment
          const workersai = createWorkersAI({
            binding: this.env.AI,
          });

          // Stream the AI response using GPT-4
          const result = streamText({
            model: workersai("@cf/meta/llama-2-7b-chat-int8"),
            system: `
              You are a helpful assistant that can do various tasks. If the user asks, then you can also schedule tasks to be executed later. The input may have a date/time/cron pattern to be input as an object into a scheduler The time is now: ${new Date().toISOString()}.
              `,
            messages: this.conversationHistory,
            tools,
            onFinish,
            maxSteps: 10,
          });

          // Merge the AI response stream with tool execution outputs
          result.mergeIntoDataStream(dataStream);

          // Update the AI model with the latest conversation context
          this.updateAIModelContext();

          // Store the entire conversation history
          this.storeConversationHistory();
        },
      });

      return dataStreamResponse;
    });
  }
  async executeTask(description: string, task: Schedule<string>) {
    await this.saveMessages([
      ...this.messages,
      {
        id: generateId(),
        role: "user",
        content: `scheduled message: ${description}`,
      },
    ]);
    // Add task to history
    this.addTaskToHistory({
      id: generateId(),
      type: task.type,
      when: task.when,
      payload: description,
    });
    // Update task analytics
    this.updateTaskAnalytics({
      id: generateId(),
      type: task.type,
      when: task.when,
      payload: description,
    });
  }

  // Add logic for dynamic scheduling adjustments
  async adjustScheduledTask(taskId: string, newSchedule: Schedule<string>) {
    // Logic to adjust the schedule of an existing task
    // This could involve updating the task's schedule in the database or in-memory storage
  }

  // Add logic for task rescheduling
  async rescheduleTask(taskId: string, newTime: Date) {
    // Logic to reschedule a task to a new time
    // This could involve updating the task's schedule in the database or in-memory storage
  }

  // Add logic for real-time task updates
  async updateTaskStatus(taskId: string, status: string) {
    // Logic to update the status of a task in real-time
    // This could involve sending a notification to the user or updating the task's status in the database
  }

  // Add logic for task analytics
  async analyzeTaskPerformance(taskId: string) {
    // Logic to analyze task performance and provide insights
    // This could involve tracking task completion times, user interactions, and other metrics
  }

  // Implement a memory mechanism to retain important details from conversations
  retainConversationDetails(details: any) {
    this.conversationHistory.push(details);
  }

  // Continuously update the context with new information as the conversation progresses
  updateContext(newInfo: any) {
    this.conversationHistory.push(newInfo);
  }

  // Store a history of scheduled tasks
  storeTaskHistory(task: { id: string; type: string; when: string | number; payload: string; category?: string }) {
    this.taskHistory.push(task);
  }

  // Store user preferences and frequently asked questions
  storeUserPreferences(userId: string, preferences: any) {
    if (!this.userProfiles[userId]) {
      this.userProfiles[userId] = { preferences: {}, frequentlyAskedQuestions: [] };
    }
    this.userProfiles[userId].preferences = preferences;
  }

  storeFrequentlyAskedQuestions(userId: string, faq: any) {
    if (!this.userProfiles[userId]) {
      this.userProfiles[userId] = { preferences: {}, frequentlyAskedQuestions: [] };
    }
    this.userProfiles[userId].frequentlyAskedQuestions.push(faq);
  }

  // Create user profiles based on contextual memory
  createUserProfile(userId: string, context: any) {
    this.userProfiles[userId] = context;
  }

  // Add a method to update the AI model with the latest conversation context
  updateAIModelContext() {
    // Logic to update the AI model with the latest conversation context
  }

  // Add a method to store the entire conversation history
  storeConversationHistory() {
    // Logic to store the entire conversation history
  }

  // Add a method to store task details and user preferences
  storeTaskDetails(task: { id: string; type: string; when: string | number; payload: string; category?: string }, userId: string, preferences: any) {
    this.storeTaskHistory(task);
    this.storeUserPreferences(userId, preferences);
  }

  // Add methods to create and update user profiles based on contextual memory
  createUserProfile(userId: string, context: any) {
    this.userProfiles[userId] = context;
  }

  updateUserProfile(userId: string, newPreferences: any, newFrequentlyAskedQuestions: any[]) {
    if (this.userProfiles[userId]) {
      this.userProfiles[userId].preferences = newPreferences;
      this.userProfiles[userId].frequentlyAskedQuestions = newFrequentlyAskedQuestions;
    }
  }

  // Integrate task history and analytics functions into user profiling
  integrateTaskHistoryAndAnalytics(userId: string, task: { id: string; type: string; when: string | number; payload: string; category?: string }) {
    this.storeTaskHistory(task);
    this.updateUserProfile(userId, this.userProfiles[userId].preferences, this.userProfiles[userId].frequentlyAskedQuestions);
  }

  // Continuously update user profiles with new information as the conversation progresses
  updateUserProfileWithNewInfo(userId: string, newInfo: any) {
    if (this.userProfiles[userId]) {
      this.userProfiles[userId].context = newInfo;
    }
  }

  // Add task to history
  addTaskToHistory(task: { id: string; type: string; when: string | number; payload: string; category?: string }) {
    this.taskHistory.push(task);
  }

  // Update task analytics
  updateTaskAnalytics(task: { id: string; type: string; when: string | number; payload: string; category?: string }) {
    // Logic to update task analytics
  }
}

/**
 * Worker entry point that routes incoming requests to the appropriate handler
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    if (!env.OPENAI_API_KEY) {
      console.error(
        "OPENAI_API_KEY is not set, don't forget to set it locally in .dev.vars, and use `wrangler secret bulk .dev.vars` to upload it to production"
      );
      return new Response("OPENAI_API_KEY is not set", { status: 500 });
    }
    return (
      // Route the request to our agent or return 404 if not found
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;
