/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-misused-promises */
/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable @typescript-eslint/no-unused-vars */
import * as https from "node:https";
import * as fs from "node:fs";
import { RawData, WebSocket } from "ws";
import express, { Request } from "express";
import expressWs from "express-ws";
import { once } from "node:events";
import { systemPrompt } from "../prompts/prompts.js";
import OpenAI from "openai";

const {
  OPENAI_API_KEY = "",
  OPENAI_MODEL = "",
  KEY_FILE = "",
  CERT_FILE = "",
  PORT = 8443,
} = process.env;

const _app = express();

const httpsServer = https.createServer({
  key: fs.readFileSync(KEY_FILE),
  cert: fs.readFileSync(CERT_FILE),
}, (...args) => void _app(...args)).listen(PORT);;

const { app } = expressWs(_app, httpsServer);

await once(httpsServer, "listening");

type ConversationHistory = {
  role: "system" | "assistant" | "user" | "developer";
  content: string;
}[];

const history: ConversationHistory = [];
history.push({ role: "system", content: systemPrompt() });

const openAI = new OpenAI({ apiKey: OPENAI_API_KEY });

// Your other API endpoints
app.get("/", (req, res) => {
  console.log(req.body);
  res.send("");
});

app.ws("/llm-websocket/:call_id",
  async (ws: WebSocket, req: Request) => {
    const callId = req.params.call_id;
    console.log("ws");
    ws.on("error", (err) => {
      console.error("Error received in LLM websocket client: ", err);
    });

    ws.send(JSON.stringify({
      response_id: 0,
      content: `How may I assist you today?`,
      content_complete: true,
      end_call: false,
    }));

    ws.on("error", (err) => {
      console.error("Error received in LLM websocket client: ", err);
    });
    
    ws.on("close", (err) => {
      console.error("Closing llm ws for: ", callId);
    });

    ws.on("message", async (data: RawData, isBinary: boolean) => {
      if (!(typeof data == "string")) {
        throw new Error("Unhandled RawData type.");
      }
    
      const request = JSON.parse(data) as any;

      if (
        request.interaction_type === "reminder_required" ||
        request.interaction_type === "response_required"
      ) {
    
        console.log(request);
    
        const content = request.transcript.pop()?.content;

        if (!content) {
          return;
        }

        let assistantMessage = "";

        history.push({ role: "user", content: content });
        const stream = await openAI.chat.completions.create({
          model: OPENAI_MODEL,
          messages: history,
          temperature: 0,
          stream: true
        });

        for await (const chunk of stream) {
          const delta = chunk.choices[0].delta;
          if (!delta.content)
            continue;

          assistantMessage = assistantMessage + delta.content;
          const res = {
            response_type: "response",
            response_id: request.response_id,
            content: delta.content,
            content_complete: false,
            end_call: false,
          };
          ws.send(JSON.stringify(res));
          if (chunk.choices[0].finish_reason == null ? false : true) {
            const res = {
              response_type: "response",
              response_id: request.response_id,
              content: "",
              content_complete: true,
              end_call: false,
            };
            ws.send(JSON.stringify(res));
          }
        }
        history.push({ role: "assistant", content: assistantMessage });
      }
    });
  },
);