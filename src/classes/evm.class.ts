import { lookupOpInfo } from '../../node_modules/ethereumjs-vm/dist/evm/opcodes.js';
import * as functionHashes from '../../data/functionHashes.json';
import * as eventHashes from '../../data/eventHashes.json';
import opcodeFunctions from '../utils/opcodes';
import stringifyEvents from '../utils/stringifyEvents';
import stringifyStructs from '../utils/stringifyStructs';
import stringifyMappings from '../utils/stringifyMappings';
import stringifyVariables from '../utils/stringifyVariables';
import stringifyFunctions from '../utils/stringifyFunctions';
import stringifyInstructions from '../utils/stringifyInstructions';
import Stack from './stack.class';
import Event from '../interfaces/event.interface';
import Instruction from '../interfaces/instruction.interface';
import Mapping from '../interfaces/mapping.interface';
import Opcode from '../interfaces/opcode.interface';
import Variable from '../interfaces/variable.interface';
import {
    STOP,
    RETURN,
    REVERT,
    INVALID,
    PUSH1,
    PUSH32,
    JUMPDEST,
    SELFDESTRUCT,
    codes,
    names
} from '../opcodes';
import * as fs from 'fs';
import * as util from 'util';
// import { CODECOPY } from '../opcodes/codecopy.js';
// import opcodes from '../utils/opcodes';
// import bufferSplice = require('buffer-splice');

export default class EVM {
    pc: number = 0;
    stack: Stack = new Stack();
    memory: any = {};
    opcodes: Opcode[] = [];
    instructions: Instruction[] = [];
    storage: any = {};
    jumps: any = {};
    code: Buffer;
    mappings: Mapping = {};
    layer: number = 0;
    halted: boolean = false;
    functions: any = {};
    variables: Variable = {};
    events: Event = {};
    gasUsed: number = 0;
    conditions: any = [];
    functionInfo: any = [];
    logdirectory: any = undefined;
    // logdirectory: any = '/tmp/';

    constructor(code: string | Buffer) {
        if (code instanceof Buffer) {
            this.code = code;
        } else {
            this.code = Buffer.from(code.replace('0x', ''), 'hex');
        }
    }

    clone(): EVM {
        const clone = new EVM(this.code);
        clone.pc = this.pc;
        clone.opcodes = this.opcodes;
        clone.stack = this.stack.clone();
        clone.memory = { ...this.memory };
        clone.storage = this.storage;
        clone.jumps = { ...this.jumps };
        clone.mappings = this.mappings;
        clone.layer = this.layer + 1;
        clone.functions = this.functions;
        clone.variables = this.variables;
        clone.events = this.events;
        clone.gasUsed = this.gasUsed;
        clone.conditions = [...this.conditions];
        clone.functionInfo = this.functionInfo;
        clone.logdirectory = this.logdirectory;
        return clone;
    }

    getBytecode(): string {
        return '0x' + this.code.toString('hex');
    }

    getOpcodes(): Opcode[] {
        if (this.opcodes.length === 0) {
            const opcodesHack: Opcode[] = [];

            for (let index = 0; index < this.code.length; index++) {
                const oplen = this.opcodes.length;

                const currentOp: Opcode = {
                    pc: index,
                    opcode: this.code[index],
                    name: 'INVALID'
                };

                if (currentOp.opcode in codes) {
                    currentOp.name = (codes as any)[this.code[index]];
                }

                // if(currentOp.name === 'CODECOPY') {
                //   console.log('CODECOPY', currentOp);

                //   const op_code_length = this.opcodes[oplen-3];
                //   const code_length = parseInt((op_code_length.pushData || new Buffer([])).toString('hex') || '0');

                //   const op_code_start = this.opcodes[oplen-2];
                //   const code_start = parseInt((op_code_start.pushData || new Buffer([])).toString('hex') || '0');

                //   const pushData = this.code.slice(code_start, code_start + code_length);
                //   const pushDataString = pushData.toString('hex');
                //   const foundEventHash = (eventHashes as any)[pushDataString];
                //   const foundFunctionHash = (functionHashes as any)[pushDataString];

                //   if (foundEventHash) {
                //       currentOp.pc = index;
                //       currentOp.opcode = 0x7f;
                //       currentOp.name = 'PUSH32';
                //       currentOp.pushData = pushData;

                //       opcodesHack.push(currentOp);
                //       // index += currentOp.opcode - 0x5f;

                //       continue;
                //   }

                //   if (foundFunctionHash) {
                //       currentOp.pc = index;
                //       currentOp.opcode = 0x63;
                //       currentOp.name = 'PUSH4';

                //       this.opcodes.push(currentOp);

                //       currentOp.pushData = pushData;
                //       // index += currentOp.opcode - 0x5f;

                //       continue;
                //   }
                // }

                // For example: 0x0f5d2fb29fb7d3cfee444a200298f468908cc942 Transfer(addres,address,uint256) is not parsed
                // https://etherscan.io/address/0xe694010c4f1fcd35ebc04ceb60f847caaf2cd6f2
                if (
                    oplen >= 2 &&
                    this.opcodes[oplen - 2].opcode === 0x56 &&
                    this.opcodes[oplen - 1].opcode === 0x00
                ) {
                    const pushEventData = this.code.slice(index, index + 32);
                    const pushEventDataString = pushEventData.toString('hex');
                    const foundEventHash = (eventHashes as any)[pushEventDataString];

                    const pushFunctionData = this.code.slice(index, index + 4);
                    const pushFunctionDataString = pushFunctionData.toString('hex');
                    const foundFunctionHash = (functionHashes as any)[pushFunctionDataString];

                    if (foundEventHash) {
                        currentOp.pc = index;
                        currentOp.opcode = 0x7f;
                        currentOp.name = 'PUSH32';
                        currentOp.pushData = pushEventData;

                        // this.opcodes.splice(oplen-2, 0, currentOp);
                        opcodesHack.push(currentOp);

                        index += currentOp.opcode - 0x5f;

                        continue;
                    } else if (foundFunctionHash) {
                        currentOp.pc = index;
                        currentOp.opcode = 0x63;
                        currentOp.name = 'PUSH4';
                        currentOp.pushData = pushFunctionData;

                        // this.opcodes.splice(oplen-2, 0, currentOp);
                        opcodesHack.push(currentOp);

                        index += currentOp.opcode - 0x5f;

                        continue;
                    }
                    // else {
                    //   // index++;
                    //   continue;
                    // }
                }

                this.opcodes.push(currentOp);

                if (!currentOp.name) {
                    console.log(currentOp);
                }

                if (currentOp.name.startsWith('PUSH')) {
                    const pushDataLength = currentOp.opcode - 0x5f;
                    const pushData = this.code.slice(index + 1, index + pushDataLength + 1);
                    currentOp.pushData = pushData;
                    index += pushDataLength;
                }
            }

            this.opcodes.push(...opcodesHack);
        }
        return this.opcodes;
    }

    getFunctions(): string[] {
        return [
            ...new Set(
                this.getOpcodes()
                    .filter(opcode => opcode.name === 'PUSH4')
                    .map(opcode => (opcode.pushData ? opcode.pushData.toString('hex') : ''))
                    .filter(hash => hash in functionHashes)
                    .map(hash => (functionHashes as any)[hash])
            )
        ];
    }

    getEvents(): string[] {
        // const events: string[] = [];

        // for(let i = 0; i < this.code.length; ++i) {
        //     const pushEventData = this.code.slice(i, i + 32);
        //     const pushEventDataString = pushEventData.toString('hex');
        //     const event = (eventHashes as any)[pushEventDataString];
        //     if(event) events.push(event);
        // }

        // return [ ...new Set(events) ];

        return [
            ...new Set(
                this.getOpcodes()
                    .filter(opcode => opcode.name === 'PUSH32')
                    .map(opcode => (opcode.pushData ? opcode.pushData.toString('hex') : ''))
                    .filter(hash => hash in eventHashes)
                    .map(hash => (eventHashes as any)[hash])
            )
        ];
    }

    containsOpcode(opcode: number | string): boolean {
        let halted = false;
        if (typeof opcode === 'string' && opcode in names) {
            opcode = (names as any)[opcode];
        } else if (typeof opcode === 'string') {
            throw new Error('Invalid opcode provided');
        }
        for (let index = 0; index < this.code.length; index++) {
            const currentOpcode = this.code[index];
            if (currentOpcode === opcode && !halted) {
                return true;
            } else if (currentOpcode === JUMPDEST) {
                halted = false;
            } else if ([STOP, RETURN, REVERT, INVALID, SELFDESTRUCT].includes(currentOpcode)) {
                halted = true;
            } else if (currentOpcode >= PUSH1 && currentOpcode <= PUSH32) {
                index += currentOpcode - PUSH1 + 0x01;
            }
        }
        return false;
    }

    getJumpDestinations(): number[] {
        return this.getOpcodes()
            .filter(opcode => opcode.name === 'JUMPDEST')
            .map(opcode => opcode.pc);
    }

    getSwarmHash(): string | false {
        const regex = /a165627a7a72305820([a-f0-9]{64})0029$/;
        const bytecode = this.getBytecode();
        const match = bytecode.match(regex);
        if (match && match[1]) {
            return 'bzzr://' + match[1];
        } else {
            return false;
        }
    }

    getABI(): any {
        const abi: any = [];
        if (this.instructions.length === 0) {
            this.parse();
        }

        // console.log('this.functions', this.functions);
        // console.log('this.events', this.events);

        const nameAndParamsRegex = /(.*)\((.*)\)/;
        Object.keys(this.functions).forEach((key: string) => {
            const matches = nameAndParamsRegex.exec(this.functions[key].label);
            if (matches !== null && matches[1] && matches[2]) {
                const item = {
                    constant: this.functions[key].constant,
                    name: matches[1],
                    inputs:
                        matches[2] !== ''
                            ? matches[2].split(',').map((input: string) => {
                                  return {
                                      name: '',
                                      type: input
                                  };
                              })
                            : [],
                    outputs:
                        this.functions[key].returns.map((output: string) => {
                            return {
                                name: '',
                                type: output
                            };
                        }) || [],
                    type: 'function'
                };
                abi.push(item);
            }
        });
        Object.keys(this.events).forEach((key: string) => {
            const matches = nameAndParamsRegex.exec(this.events[key].label);
            if (matches !== null && matches[1] && matches[2]) {
                const item = {
                    anonymous: false,
                    inputs:
                        matches[2] !== ''
                            ? matches[2].split(',').map((input: string, index: number) => {
                                  return {
                                      indexed: index < this.events[key].indexedCount ? true : false,
                                      name: '',
                                      type: input
                                  };
                              })
                            : [],
                    name: matches[1],
                    type: 'event'
                };
                abi.push(item);
            }
        });

        return abi;
    }

    reset(): void {
        this.pc = 0;
        this.instructions = [];
        this.stack.reset();
        this.memory = {};
        this.storage = {};
        this.jumps = {};
        this.mappings = {};
        this.functions = {};
        this.variables = {};
        this.events = {};
        this.gasUsed = 0;
    }
    log(pc: number, opcode?: Opcode): void {
        const logname = this.logdirectory + 'log.txt';
        if (opcode !== undefined) {
            fs.appendFileSync(logname, '==========\n');
        }
        fs.appendFileSync(
            logname,
            'Stack: ' + util.inspect(this.stack, { showHidden: false, depth: null }) + '\n'
        );
        fs.appendFileSync(
            logname,
            'Instructions: ' +
                util.inspect(this.instructions, { showHidden: false, depth: null }) +
                '\n'
        );
        fs.appendFileSync(
            logname,
            'Memory: ' + util.inspect(this.memory, { showHidden: false, depth: null }) + '\n'
        );
        if (opcode !== undefined) {
            fs.appendFileSync(
                logname,
                '0x' +
                    pc.toString(16) +
                    ' ' +
                    opcode.name +
                    ' ' +
                    (opcode.pushData ? opcode.pushData.toString('hex') : '') +
                    '\n'
            );
        }
    }

    loglowlevel(data: any): void {
        if (this.logdirectory) {
            const logname = this.logdirectory + 'log.txt';
            fs.appendFileSync(logname, data + '\n');
        }
    }

    parse(): Instruction[] {
        if (this.instructions.length === 0) {
            const opcodes = this.getOpcodes();
            const oplen = opcodes.length;

            for (this.pc; this.pc < opcodes.length && !this.halted; this.pc++) {
                const opcode = opcodes[this.pc];

                if (this.logdirectory) {
                    this.log(this.pc, opcode);
                }

                if (!(opcode.name in opcodeFunctions)) {
                    throw new Error('Unknown OPCODE: ' + opcode.name);
                } else {
                    (opcodeFunctions as any)[opcode.name](opcode, this);
                }
                if (this.logdirectory) {
                    this.log(this.pc);
                }
            }
        }
        return this.instructions;
    }

    decompile(): string {
        const instructionTree = this.parse();
        const events = stringifyEvents(this.events, this.getEvents());
        const structs = stringifyStructs(this.mappings);
        const mappings = stringifyMappings(this.mappings);
        const variables = stringifyVariables(this.variables);
        const functions = Object.keys(this.functions)
            .map((functionName: string) =>
                stringifyFunctions(functionName, this.functions[functionName])
            )
            .join('');
        const code = stringifyInstructions(instructionTree);
        return events + structs + mappings + variables + functions + code;
    }

    isERC165(): boolean {
        return ['supportsInterface(bytes4)'].every(v => this.getFunctions().includes(v));
    }
}
