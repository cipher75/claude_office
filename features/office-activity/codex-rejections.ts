import { parse } from "acorn";

export type CodexRejection = {
  callId: string;
  turnId: string;
  command: string;
  startedAt: number;
  completedAt: number;
};

export type CodexCodeCall = Omit<CodexRejection, "completedAt">;

// 코드 모드의 단일 셸 호출만 읽는다. 동적 코드나 여러 호출의 실행 순서는 추정하지 않는다.
export function codexCodeCall(payload: Record<string, unknown>): CodexCodeCall | undefined {
  if (payload.type !== "custom_tool_call" || payload.name !== "exec" ||
    typeof payload.call_id !== "string" || typeof payload.input !== "string") return;
  const metadata = payload.internal_chat_message_metadata_passthrough as Record<string, unknown> | undefined;
  if (typeof metadata?.turn_id !== "string" || typeof metadata.create_time !== "number" || !Number.isFinite(metadata.create_time)) return;
  try {
    const program = parse(payload.input, { ecmaVersion: "latest", allowAwaitOutsideFunction: true });
    const [first, second] = program.body;
    let expression;
    if (program.body.length === 1 && first.type === "ExpressionStatement") {
      expression = first.expression;
    } else if (program.body.length === 2 && first.type === "VariableDeclaration" && first.kind === "const" &&
      first.declarations.length === 1 && first.declarations[0].id.type === "Identifier" &&
      second.type === "ExpressionStatement" && second.expression.type === "CallExpression" &&
      second.expression.callee.type === "Identifier" && second.expression.callee.name === "text" &&
      second.expression.arguments.length === 1 && second.expression.arguments[0].type === "Identifier" &&
      second.expression.arguments[0].name === first.declarations[0].id.name) {
      expression = first.declarations[0].init;
    }
    if (!expression) return;
    if (expression.type === "CallExpression" && expression.callee.type === "Identifier" && expression.callee.name === "text") {
      if (expression.arguments.length !== 1 || expression.arguments[0].type !== "AwaitExpression") return;
      expression = expression.arguments[0];
    }
    if (expression.type !== "AwaitExpression") return;
    const call = expression.argument;
    if (call.type !== "CallExpression" || call.callee.type !== "MemberExpression" || call.callee.computed ||
      call.callee.object.type !== "Identifier" || call.callee.object.name !== "tools" ||
      call.callee.property.type !== "Identifier" || call.callee.property.name !== "exec_command" ||
      call.arguments.length !== 1 || call.arguments[0].type !== "ObjectExpression") return;
    let command: string | undefined;
    for (const property of call.arguments[0].properties) {
      if (property.type !== "Property" || property.computed || property.method || property.kind !== "init" || property.value.type !== "Literal") return;
      const key = property.key.type === "Identifier" ? property.key.name : property.key.type === "Literal" ? property.key.value : undefined;
      if (key === "cmd") {
        if (command !== undefined || typeof property.value.value !== "string") return;
        command = property.value.value;
      }
    }
    if (command === undefined) return;
    return { callId: payload.call_id, turnId: metadata.turn_id, command, startedAt: metadata.create_time * 1000 };
  } catch {
    return;
  }
}

// 실제 0.167이 저장한 코드 실행 오류다. 일반 출력의 인용문은 거절 증거로 쓰지 않는다.
export function codexCodeRejection(payload: Record<string, unknown>, call: CodexCodeCall | undefined): CodexRejection | undefined {
  if (!call || payload.type !== "custom_tool_call_output" || !Array.isArray(payload.output) || payload.output.length !== 2) return;
  const [header, error] = payload.output;
  if (header?.type !== "input_text" || typeof header.text !== "string" || !header.text.startsWith("Script failed\n") ||
    error?.type !== "input_text" || typeof error.text !== "string" ||
    error.text.replaceAll("\\", "") !== 'Script error:\nexec_command failed: CreateProcess { message: "Rejected("rejected by user")" }') return;
  const metadata = payload.internal_chat_message_metadata_passthrough as Record<string, unknown> | undefined;
  if (metadata?.turn_id !== call.turnId || typeof metadata.create_time !== "number" || !Number.isFinite(metadata.create_time)) return;
  const completedAt = metadata.create_time * 1000;
  if (completedAt < call.startedAt) return;
  return { ...call, completedAt };
}
