import { ActionError, defineAction, type ActionAPIContext } from "astro:actions";
import { z } from "astro:schema";
import {
  TriviaAnswers,
  TriviaPlayers,
  TriviaQuestions,
  TriviaRooms,
  and,
  asc,
  db,
  eq,
  sql,
} from "astro:db";

function requireUser(context: ActionAPIContext) {
  const locals = context.locals as App.Locals | undefined;
  const user = locals?.user;

  if (!user) {
    throw new ActionError({
      code: "UNAUTHORIZED",
      message: "You must be signed in to perform this action.",
    });
  }

  return user;
}

async function loadOwnedRoom(roomId: string, userId: string) {
  const [room] = await db
    .select()
    .from(TriviaRooms)
    .where(and(eq(TriviaRooms.id, roomId), eq(TriviaRooms.hostUserId, userId)))
    .limit(1);

  if (!room) {
    throw new ActionError({
      code: "NOT_FOUND",
      message: "Room not found for this user.",
    });
  }

  return room;
}

export const server = {
  createRoom: defineAction({
    input: z.object({
      name: z.string().min(1),
      accessCode: z.string().optional(),
      status: z.enum(["lobby", "in-progress", "completed"]).optional(),
      maxPlayers: z.number().int().positive().optional(),
    }),
    handler: async (input, context) => {
      const user = requireUser(context);
      const now = new Date();
      const room = {
        id: crypto.randomUUID(),
        hostUserId: user.id,
        name: input.name,
        accessCode: input.accessCode ?? null,
        status: input.status ?? "lobby",
        maxPlayers: input.maxPlayers ?? null,
        createdAt: now,
        updatedAt: now,
      } as const;

      await db.insert(TriviaRooms).values(room);

      return {
        success: true,
        data: { room },
      };
    },
  }),

  updateRoom: defineAction({
    input: z.object({
      id: z.string().min(1),
      name: z.string().min(1).optional(),
      accessCode: z.string().optional(),
      status: z.enum(["lobby", "in-progress", "completed"]).optional(),
      maxPlayers: z.number().int().positive().optional(),
    }),
    handler: async (input, context) => {
      const user = requireUser(context);
      const room = await loadOwnedRoom(input.id, user.id);

      const updates: Record<string, unknown> = {
        updatedAt: new Date(),
      };

      if (input.name) updates.name = input.name;
      if (input.accessCode !== undefined) updates.accessCode = input.accessCode;
      if (input.status) updates.status = input.status;
      if (input.maxPlayers !== undefined) updates.maxPlayers = input.maxPlayers;

      if (Object.keys(updates).length === 1) {
        throw new ActionError({
          code: "BAD_REQUEST",
          message: "No changes provided for update.",
        });
      }

      await db.update(TriviaRooms).set(updates).where(eq(TriviaRooms.id, room.id));

      return {
        success: true,
        data: {
          room: {
            ...room,
            ...updates,
          },
        },
      };
    },
  }),

  listMyRooms: defineAction({
    input: z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(50).default(20),
    }),
    handler: async (input, context) => {
      const user = requireUser(context);
      const offset = (input.page - 1) * input.pageSize;

      const rooms = await db
        .select()
        .from(TriviaRooms)
        .where(eq(TriviaRooms.hostUserId, user.id))
        .orderBy(asc(TriviaRooms.createdAt))
        .limit(input.pageSize)
        .offset(offset);

      const [countResult] = await db
        .select({ total: sql<number>`count(*)` })
        .from(TriviaRooms)
        .where(eq(TriviaRooms.hostUserId, user.id));

      return {
        success: true,
        data: {
          items: rooms,
          total: Number(countResult?.total ?? rooms.length),
        },
      };
    },
  }),

  upsertQuestion: defineAction({
    input: z.object({
      roomId: z.string().min(1),
      id: z.string().optional(),
      orderIndex: z.number().int().min(0),
      questionText: z.string().min(1),
      optionA: z.string().optional(),
      optionB: z.string().optional(),
      optionC: z.string().optional(),
      optionD: z.string().optional(),
      correctOptionKey: z.enum(["A", "B", "C", "D"]).optional(),
      timeLimitSeconds: z.number().int().positive().optional(),
    }),
    handler: async (input, context) => {
      const user = requireUser(context);
      await loadOwnedRoom(input.roomId, user.id);

      const questionPayload = {
        roomId: input.roomId,
        orderIndex: input.orderIndex,
        questionText: input.questionText,
        optionA: input.optionA ?? null,
        optionB: input.optionB ?? null,
        optionC: input.optionC ?? null,
        optionD: input.optionD ?? null,
        correctOptionKey: input.correctOptionKey ?? null,
        timeLimitSeconds: input.timeLimitSeconds ?? null,
      } as const;

      if (input.id) {
        const [existing] = await db
          .select()
          .from(TriviaQuestions)
          .where(eq(TriviaQuestions.id, input.id))
          .limit(1);

        if (!existing) {
          throw new ActionError({
            code: "NOT_FOUND",
            message: "Question not found.",
          });
        }

        if (existing.roomId !== input.roomId) {
          throw new ActionError({
            code: "FORBIDDEN",
            message: "Question does not belong to this room.",
          });
        }

        await db
          .update(TriviaQuestions)
          .set(questionPayload)
          .where(eq(TriviaQuestions.id, input.id));

        return {
          success: true,
          data: {
            question: {
              ...existing,
              ...questionPayload,
            },
          },
        };
      }

      const newQuestion = {
        id: crypto.randomUUID(),
        ...questionPayload,
        createdAt: new Date(),
      } as const;

      await db.insert(TriviaQuestions).values(newQuestion);

      return {
        success: true,
        data: { question: newQuestion },
      };
    },
  }),

  listRoomQuestions: defineAction({
    input: z.object({
      roomId: z.string().min(1),
    }),
    handler: async (input, context) => {
      const user = requireUser(context);
      await loadOwnedRoom(input.roomId, user.id);

      const questions = await db
        .select()
        .from(TriviaQuestions)
        .where(eq(TriviaQuestions.roomId, input.roomId))
        .orderBy(asc(TriviaQuestions.orderIndex));

      return {
        success: true,
        data: {
          items: questions,
          total: questions.length,
        },
      };
    },
  }),

  joinRoom: defineAction({
    input: z.object({
      roomId: z.string().min(1),
      displayName: z.string().min(1).max(120).optional(),
    }),
    handler: async (input, context) => {
      const user = requireUser(context);
      const [room] = await db
        .select()
        .from(TriviaRooms)
        .where(eq(TriviaRooms.id, input.roomId))
        .limit(1);

      if (!room) {
        throw new ActionError({
          code: "NOT_FOUND",
          message: "Room not found.",
        });
      }

      const [existing] = await db
        .select()
        .from(TriviaPlayers)
        .where(
          and(
            eq(TriviaPlayers.roomId, input.roomId),
            eq(TriviaPlayers.userId, user.id)
          )
        )
        .limit(1);

      if (existing) {
        return {
          success: true,
          data: { player: existing },
        };
      }

      const player = {
        id: crypto.randomUUID(),
        roomId: input.roomId,
        userId: user.id,
        displayName: input.displayName ?? user.email ?? "Player",
        totalScore: 0,
        joinedAt: new Date(),
      } as const;

      await db.insert(TriviaPlayers).values(player);

      return {
        success: true,
        data: { player },
      };
    },
  }),

  recordAnswer: defineAction({
    input: z.object({
      questionId: z.string().min(1),
      playerId: z.string().min(1),
      selectedOptionKey: z.enum(["A", "B", "C", "D"]).optional(),
    }),
    handler: async (input, context) => {
      const user = requireUser(context);

      const [question] = await db
        .select()
        .from(TriviaQuestions)
        .where(eq(TriviaQuestions.id, input.questionId))
        .limit(1);

      if (!question) {
        throw new ActionError({
          code: "NOT_FOUND",
          message: "Question not found.",
        });
      }

      const [player] = await db
        .select()
        .from(TriviaPlayers)
        .where(eq(TriviaPlayers.id, input.playerId))
        .limit(1);

      if (!player) {
        throw new ActionError({
          code: "NOT_FOUND",
          message: "Player not found.",
        });
      }

      if (player.roomId !== question.roomId) {
        throw new ActionError({
          code: "BAD_REQUEST",
          message: "Player and question are in different rooms.",
        });
      }

      const [room] = await db
        .select()
        .from(TriviaRooms)
        .where(eq(TriviaRooms.id, question.roomId))
        .limit(1);

      if (!room) {
        throw new ActionError({
          code: "NOT_FOUND",
          message: "Room not found.",
        });
      }

      const isOwner = room.hostUserId === user.id;
      const isPlayerUser = player.userId === user.id;

      if (!isOwner && !isPlayerUser) {
        throw new ActionError({
          code: "FORBIDDEN",
          message: "You do not have permission to record this answer.",
        });
      }

      const isCorrect =
        !!input.selectedOptionKey &&
        !!question.correctOptionKey &&
        input.selectedOptionKey === question.correctOptionKey;

      const newScore = isCorrect ? 10 : 0;

      const [existingAnswer] = await db
        .select()
        .from(TriviaAnswers)
        .where(
          and(
            eq(TriviaAnswers.questionId, input.questionId),
            eq(TriviaAnswers.playerId, input.playerId)
          )
        )
        .limit(1);

      const now = new Date();
      const previousScore = existingAnswer?.scoreAwarded ?? 0;

      const answerId = existingAnswer?.id ?? crypto.randomUUID();

      if (existingAnswer) {
        await db
          .update(TriviaAnswers)
          .set({
            selectedOptionKey: input.selectedOptionKey ?? null,
            isCorrect,
            answeredAt: now,
            scoreAwarded: newScore,
          })
          .where(eq(TriviaAnswers.id, answerId));
      } else {
        await db.insert(TriviaAnswers).values({
          id: answerId,
          questionId: input.questionId,
          playerId: input.playerId,
          selectedOptionKey: input.selectedOptionKey ?? null,
          isCorrect,
          answeredAt: now,
          scoreAwarded: newScore,
        });
      }

      await db
        .update(TriviaPlayers)
        .set({ totalScore: player.totalScore - previousScore + newScore })
        .where(eq(TriviaPlayers.id, player.id));

      return {
        success: true,
        data: {
          answer: {
            id: answerId,
            questionId: input.questionId,
            playerId: input.playerId,
            selectedOptionKey: input.selectedOptionKey ?? null,
            isCorrect,
            answeredAt: now,
            scoreAwarded: newScore,
          },
        },
      };
    },
  }),
};
