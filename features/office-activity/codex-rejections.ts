import { parse, type Expression, type Node, type Statement } from "acorn";

export type CodexCodeCall = {
  callId: string;
  turnId: string;
  startedAt: number;
  completedAt?: number;
  // undefined는 해석하지 못한 코드다. 겹친 호출의 소유권 판단에서 제외하지 않는다.
  commands?: string[];
  settledOutput?: "array" | "each";
  settledCommands?: (string | null)[];
  outputOffset?: number;
  outputTail?: number;
};

export type CodexRejection = {
  callId: string;
  wrapperCallId: string;
  turnId: string;
  commands: string[];
  startedAt: number;
  completedAt: number;
};

const REJECTION = 'exec_command failed: CreateProcess { message: "Rejected("rejected by user")" }';
const isRejection = (value: unknown) => typeof value === "string" && value.replaceAll("\\", "") === REJECTION;

// 소유권을 알 수 없는 코드도 시간 범위는 남겨, 다른 코드의 캐릭터를 잘못 거절하지 않는다.
export function codexCodeCall(payload: Record<string, unknown>): CodexCodeCall | undefined {
  if (payload.type !== "custom_tool_call" || payload.name !== "exec" ||
    typeof payload.call_id !== "string" || typeof payload.input !== "string") return;
  const metadata = payload.internal_chat_message_metadata_passthrough as Record<string, unknown> | undefined;
  if (typeof metadata?.turn_id !== "string" || typeof metadata.create_time !== "number" || !Number.isFinite(metadata.create_time)) return;
  const call: CodexCodeCall = { callId: payload.call_id, turnId: metadata.turn_id, startedAt: metadata.create_time * 1000 };
  try {
    const program = parse(payload.input, { ecmaVersion: "latest", allowAwaitOutsideFunction: true });
    for (let index = 0; index < program.body.length; index++) {
      for (const width of [2, 1]) {
        const settled = readSettled(program.body.slice(index, index + width));
        if (!settled) continue;
        const prefix = readSequential(program.body.slice(0, index));
        const suffix = readSequential(program.body.slice(index + width));
        if (prefix && suffix) return { ...call, ...settled,
          commands: [...prefix.commands, ...settled.commands!, ...suffix.commands],
          outputOffset: prefix.outputs, outputTail: suffix.outputs };
      }
    }
    const sequential = readSequential(program.body);
    return sequential ? { ...call, commands: sequential.commands } : call;
  } catch {
    return call;
  }
}

function readSequential(body: ReturnType<typeof parse>["body"]): { commands: string[]; outputs: number } | undefined {
  const commands: string[] = [];
  const bindings = new Set<string>();
  let outputs = 0;
  for (const statement of body) {
    let expression;
    if (statement.type === "VariableDeclaration" && statement.kind === "const" && statement.declarations.length === 1 &&
      statement.declarations[0].id.type === "Identifier" && !bindings.has(statement.declarations[0].id.name)) {
      const name = statement.declarations[0].id.name;
      if (["tools", "text", "Promise"].includes(name)) return;
      expression = statement.declarations[0].init;
      bindings.add(name);
    } else if (statement.type === "ExpressionStatement") {
      expression = statement.expression;
      if (expression.type === "CallExpression" && expression.callee.type === "Identifier" && expression.callee.name === "text" &&
        expression.arguments.length === 1) {
        outputs++;
        expression = expression.arguments[0];
        if (expression.type === "Identifier" && bindings.has(expression.name)) continue;
        if (expression.type === "MemberExpression" && !expression.computed && expression.object.type === "Identifier" &&
          bindings.has(expression.object.name) && expression.property.type === "Identifier" && expression.property.name === "output") continue;
      }
    }
    if (expression?.type !== "AwaitExpression") return;
    const command = toolCommand(expression.argument);
    if (command === undefined) return;
    if (command !== null) commands.push(command);
  }
  return { commands, outputs };
}

// Bash가 아닌 직접 도구 호출은 결과 배열의 자리만 보존한다. 임의의 함수나 동적 인수는 읽지 않는다.
function toolCommand(node: Node): string | null | undefined {
  const call = node as Expression;
  if (call.type !== "CallExpression" || call.callee.type !== "MemberExpression" || call.callee.computed ||
    call.callee.object.type !== "Identifier" || call.callee.object.name !== "tools" || call.callee.property.type !== "Identifier") return;
  if (call.callee.property.name === "exec_command") return shellCommand(call);
  return call.arguments.every((argument) => argument.type !== "SpreadElement" && staticValue(argument)) ? null : undefined;
}

function staticValue(node: Node): boolean {
  const value = node as Expression;
  if (value.type === "Literal") return true;
  if (value.type === "ArrayExpression") return value.elements.every((item) => item !== null && item.type !== "SpreadElement" && staticValue(item));
  return value.type === "ObjectExpression" && value.properties.every((property) => property.type === "Property" &&
    !property.computed && !property.method && property.kind === "init" && staticValue(property.value));
}

function shellCommand(node: Node): string | undefined {
  if (node.type !== "CallExpression") return;
  const call = node as Expression;
  if (call.type !== "CallExpression" || call.callee.type !== "MemberExpression" || call.callee.computed ||
    call.callee.object.type !== "Identifier" || call.callee.object.name !== "tools" ||
    call.callee.property.type !== "Identifier" || call.callee.property.name !== "exec_command" ||
    call.arguments.length !== 1 || call.arguments[0].type !== "ObjectExpression") return;
  let command: string | undefined;
  for (const property of call.arguments[0].properties) {
    if (property.type !== "Property" || property.computed || property.method || property.kind !== "init" || !staticValue(property.value)) return;
    const key = property.key.type === "Identifier" ? property.key.name : property.key.type === "Literal" ? property.key.value : undefined;
    if (key === "cmd") {
      if (command !== undefined || property.value.type !== "Literal" || typeof property.value.value !== "string") return;
      command = property.value.value;
    }
  }
  return command;
}

// 변형하지 않은 allSettled 결과만 배열 위치로 내부 명령과 연결한다.
function readSettled(body: ReturnType<typeof parse>["body"]): Pick<CodexCodeCall, "commands" | "settledOutput" | "settledCommands"> | undefined {
  let expression;
  let binding: string | undefined;
  if (body.length === 1 && body[0].type === "ExpressionStatement") {
    const print = body[0].expression;
    if (print.type !== "CallExpression" || print.callee.type !== "Identifier" || print.callee.name !== "text" || print.arguments.length !== 1) return;
    expression = print.arguments[0];
  } else if (body.length === 2 && body[0].type === "VariableDeclaration" && body[0].kind === "const" && body[0].declarations.length === 1 &&
    body[0].declarations[0].id.type === "Identifier") {
    binding = body[0].declarations[0].id.name;
    if (["tools", "text", "Promise"].includes(binding)) return;
    expression = body[0].declarations[0].init;
  }
  if (expression?.type !== "AwaitExpression" || expression.argument.type !== "CallExpression") return;
  const group = expression.argument;
  if (group.callee.type !== "MemberExpression" || group.callee.computed || group.callee.object.type !== "Identifier" ||
    group.callee.object.name !== "Promise" || group.callee.property.type !== "Identifier" || group.callee.property.name !== "allSettled" ||
    group.arguments.length !== 1 || group.arguments[0].type !== "ArrayExpression" || !group.arguments[0].elements.length) return;
  const commands = group.arguments[0].elements.map((element) => element ? toolCommand(element) : undefined);
  if (commands.some((command) => command === undefined)) return;
  let settledOutput: "array" | "each" = "array";
  if (binding) {
    const output = body[1];
    if (output.type === "ExpressionStatement") {
      const print = output.expression;
      if (print.type === "CallExpression" && print.callee.type === "MemberExpression" && !print.callee.computed &&
        print.callee.object.type === "Identifier" && print.callee.object.name === binding &&
        print.callee.property.type === "Identifier" && print.callee.property.name === "forEach" && print.arguments.length === 1 &&
        print.arguments[0].type === "ArrowFunctionExpression") {
        const callback = print.arguments[0];
        if (callback.async || ![1, 2].includes(callback.params.length) || callback.params.some((p) => p.type !== "Identifier")) return;
        const names = callback.params.map((p) => (p as { name: string }).name);
        if (new Set(names).size !== names.length || names.some((name) => ["text", "tools", "Promise", binding].includes(name))) return;
        if (!printsResult(callback.body, (value) => value.type === "Identifier" && value.name === names[0], names[1])) return;
        settledOutput = "each";
      } else if (print.type !== "CallExpression" || print.callee.type !== "Identifier" || print.callee.name !== "text" ||
        print.arguments.length !== 1 || print.arguments[0].type !== "Identifier" || print.arguments[0].name !== binding) return;
    } else if (output.type === "ForOfStatement" && !output.await && output.right.type === "Identifier" && output.right.name === binding &&
      output.left.type === "VariableDeclaration" && output.left.kind === "const" && output.left.declarations.length === 1 &&
      output.left.declarations[0].id.type === "Identifier") {
      const item = output.left.declarations[0].id.name;
      const statement = output.body.type === "BlockStatement" && output.body.body.length === 1 ? output.body.body[0] : output.body;
      if (["text", "tools", "Promise", binding].includes(item) || statement.type !== "ExpressionStatement") return;
      const print = statement.expression;
      if (print.type !== "CallExpression" || print.callee.type !== "Identifier" || print.callee.name !== "text" || print.arguments.length !== 1 ||
        print.arguments[0].type !== "Identifier" || print.arguments[0].name !== item) return;
      settledOutput = "each";
    } else if (output.type === "ForStatement" && output.init?.type === "VariableDeclaration" && output.init.kind === "let" &&
      output.init.declarations.length === 1 && output.init.declarations[0].id.type === "Identifier" &&
      output.init.declarations[0].init?.type === "Literal" && output.init.declarations[0].init.value === 0) {
      const index = output.init.declarations[0].id.name;
      const test = output.test;
      const update = output.update;
      if (["text", "tools", "Promise", binding].includes(index) || test?.type !== "BinaryExpression" || test.operator !== "<" ||
        test.left.type !== "Identifier" || test.left.name !== index || test.right.type !== "MemberExpression" || test.right.computed ||
        test.right.object.type !== "Identifier" || test.right.object.name !== binding ||
        test.right.property.type !== "Identifier" || test.right.property.name !== "length" ||
        update?.type !== "UpdateExpression" || update.operator !== "++" || update.argument.type !== "Identifier" || update.argument.name !== index ||
        !printsResult(output.body, (value) => value.type === "MemberExpression" && value.computed &&
          value.object.type === "Identifier" && value.object.name === binding && value.property.type === "Identifier" && value.property.name === index, index)) return;
      settledOutput = "each";
    } else return;
  }
  return { commands: commands.filter((command): command is string => typeof command === "string"),
    settledCommands: commands as (string | null)[], settledOutput };
}

// 결과에 순번만 덧붙이는 출력은 허용한다. status/reason을 덮어쓰거나 순서를 바꾸는 코드는 읽지 않는다.
function printsResult(node: Expression | Statement, matches: (value: Expression) => boolean, index?: string): boolean {
  if (node.type === "BlockStatement") return node.body.length === 1 && printsResult(node.body[0], matches, index);
  if (node.type === "ExpressionStatement") return printsResult(node.expression, matches, index);
  if (node.type !== "CallExpression" || node.callee.type !== "Identifier" || node.callee.name !== "text" || node.arguments.length !== 1) return false;
  const value = node.arguments[0];
  if (value.type === "SpreadElement") return false;
  if (matches(value)) return true;
  if (!index || value.type !== "ObjectExpression") return false;
  let spreads = 0;
  for (const property of value.properties) {
    if (property.type === "SpreadElement") {
      if (!matches(property.argument)) return false;
      spreads++;
    } else {
      const key = property.key.type === "Identifier" ? property.key.name : property.key.type === "Literal" ? property.key.value : undefined;
      if (property.computed || property.method || property.kind !== "init" || typeof key !== "string" || ["status", "reason", "__proto__"].includes(key) ||
        property.value.type !== "Identifier" || property.value.name !== index) return false;
    }
  }
  return spreads === 1;
}

// 실제 0.167의 오류와 변형 없는 allSettled 결과만 읽는다. 일반 출력의 인용문은 증거로 쓰지 않는다.
export function codexCodeRejections(payload: Record<string, unknown>, call: CodexCodeCall | undefined): CodexRejection[] {
  if (!call?.commands || payload.type !== "custom_tool_call_output" || !Array.isArray(payload.output) || payload.output.length < 2) return [];
  const metadata = payload.internal_chat_message_metadata_passthrough as Record<string, unknown> | undefined;
  if (metadata?.turn_id !== call.turnId || typeof metadata.create_time !== "number" || !Number.isFinite(metadata.create_time)) return [];
  const completedAt = metadata.create_time * 1000;
  if (completedAt < call.startedAt) return [];
  const base = { wrapperCallId: call.callId, turnId: call.turnId, startedAt: call.startedAt, completedAt };
  const [header] = payload.output;
  if (header?.type !== "input_text" || typeof header.text !== "string") return [];
  if (call.settledOutput && header.text.startsWith("Script completed\n")) {
    try {
      const offset = call.outputOffset ?? 0;
      const tail = call.outputTail ?? 0;
      const blocks = payload.output.slice(1 + offset, tail ? -tail : undefined);
      if (blocks.some((block) => block?.type !== "input_text" || typeof block.text !== "string")) return [];
      const results: unknown[] = call.settledOutput === "array" && blocks.length === 1 ? JSON.parse(blocks[0].text) :
        call.settledOutput === "each" ? blocks.map((block) => JSON.parse(block.text)) : [];
      if (!Array.isArray(results) || results.length !== call.settledCommands?.length || results.some((r) => !r || typeof r !== "object" ||
        !["fulfilled", "rejected"].includes((r as { status: string }).status))) return [];
      return results.flatMap((result, index) => {
        const item = result as { status: string; reason?: unknown };
        return item.status === "rejected" && isRejection(item.reason) && typeof call.settledCommands?.[index] === "string" ?
          [{ ...base, callId: `${call.callId}:${index}`, commands: [call.settledCommands![index]!] }] : [];
      });
    } catch { return []; }
  }
  const error = payload.output.at(-1);
  if (!call.settledOutput && call.commands.length === 1 && header.text.startsWith("Script failed\n") && error?.type === "input_text" &&
    typeof error.text === "string" && error.text.startsWith("Script error:\n") && isRejection(error.text.slice("Script error:\n".length))) {
    return [{ ...base, callId: call.callId, commands: call.commands }];
  }
  return [];
}
