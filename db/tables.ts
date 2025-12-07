/**
 * Trivia Arena - host multiplayer trivia rounds.
 *
 * Design goals:
 * - Architecture ready for rooms, rounds, and player participation.
 * - Not tied to real-time networking here, just state/history.
 * - Questions can be stored per-room or referenced from a central bank later.
 */

import { defineTable, column, NOW } from "astro:db";

export const TriviaRooms = defineTable({
  columns: {
    id: column.text({ primaryKey: true }),
    hostUserId: column.text(),                         // room owner
    name: column.text(),                               // "Friday Fun Quiz"
    accessCode: column.text({ optional: true }),       // join code if used
    status: column.text({ optional: true }),           // "lobby", "in-progress", "completed"
    maxPlayers: column.number({ optional: true }),
    createdAt: column.date({ default: NOW }),
    updatedAt: column.date({ default: NOW }),
  },
});

export const TriviaPlayers = defineTable({
  columns: {
    id: column.text({ primaryKey: true }),
    roomId: column.text({
      references: () => TriviaRooms.columns.id,
    }),
    userId: column.text({ optional: true }),           // null if guest
    displayName: column.text(),
    totalScore: column.number({ default: 0 }),
    joinedAt: column.date({ default: NOW }),
    leftAt: column.date({ optional: true }),
  },
});

export const TriviaQuestions = defineTable({
  columns: {
    id: column.text({ primaryKey: true }),
    roomId: column.text({
      references: () => TriviaRooms.columns.id,
    }),
    orderIndex: column.number(),                       // question sequence in room
    questionText: column.text(),
    optionA: column.text({ optional: true }),
    optionB: column.text({ optional: true }),
    optionC: column.text({ optional: true }),
    optionD: column.text({ optional: true }),
    correctOptionKey: column.text({ optional: true }), // "A", "B", "C", "D"
    timeLimitSeconds: column.number({ optional: true }),
    createdAt: column.date({ default: NOW }),
  },
});

export const TriviaAnswers = defineTable({
  columns: {
    id: column.text({ primaryKey: true }),
    questionId: column.text({
      references: () => TriviaQuestions.columns.id,
    }),
    playerId: column.text({
      references: () => TriviaPlayers.columns.id,
    }),
    selectedOptionKey: column.text({ optional: true }), // "A", "B", "C", "D", null if timeout
    isCorrect: column.boolean({ default: false }),
    answeredAt: column.date({ default: NOW }),
    scoreAwarded: column.number({ default: 0 }),
  },
});

export const tables = {
  TriviaRooms,
  TriviaPlayers,
  TriviaQuestions,
  TriviaAnswers,
} as const;
