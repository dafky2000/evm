import EVM from '../classes/evm.class';
import Opcode from '../interfaces/opcode.interface';
import * as BigNumber from '../../node_modules/big-integer';
import stringify from '../utils/stringify';

export class JUMP {
    readonly name: string;
    readonly type?: string;
    readonly wrapped: boolean;
    readonly valid: boolean;
    readonly location: any;

    constructor(location: any, bad?: boolean) {
        this.name = 'JUMP';
        this.wrapped = false;
        this.location = location;
        this.valid = true;
        if (bad) {
            this.valid = false;
        }
    }

    toString() {
        if (!this.valid) {
            return (
                'revert("Bad jump destination for JUMP; location = 0x' +
                this.location.toString(16) +
                ' ");'
            );
        } else {
            return 'goto(' + stringify(this.location) + ');';
        }
    }
}

export class FUNCTIONCALL {
    readonly name: string;
    readonly location: string;
    readonly functionname: string;

    constructor(functionname: string, location: any) {
        this.name = 'FUNCTIONCALL';
        this.functionname = functionname;
        this.location = location;
    }

    toString() {
        return this.functionname + '(' + this.location + ')';
    }
}

export default (opcode: Opcode, state: EVM): void => {
    const jumpLocation = state.stack.pop();
    if (!BigNumber.isInstance(jumpLocation)) {
        state.halted = true;
        state.instructions.push(new JUMP(jumpLocation, true));
    } else {
        const opcodes = state.getOpcodes();
        const jumpLocationData = opcodes.find((o: any) => o.pc === jumpLocation.toJSNumber());
        if (!jumpLocationData) {
            // console.log('JUMP Halting #1!');
            state.halted = true;
            state.instructions.push(new JUMP(jumpLocation, true));
        } else {
            const jumpIndex = opcodes.indexOf(jumpLocationData);
            if (!(opcode.pc + ':' + jumpLocation.toJSNumber() in state.jumps)) {
                if (!jumpLocationData || jumpLocationData.name !== 'JUMPDEST') {
                    // console.log('JUMP Halting #2!');
                    state.halted = true;
                    state.instructions.push(new JUMP(jumpLocation, true));
                } else if (
                    jumpLocationData &&
                    jumpIndex >= 0 &&
                    jumpLocationData.name === 'JUMPDEST'
                ) {
                    const jumpSummary =
                        'JUMP from 0x' +
                        opcode.pc.toString(16) +
                        ' to 0x' +
                        jumpLocation.toJSNumber().toString(16) +
                        ', top stack: ' +
                        stringify(state.stack.elements[0]);
                    state.loglowlevel(jumpSummary);

                    let jumped = false;
                    if (state.functionInfo.list) {
                        for (const element of state.functionInfo.list) {
                            // check if we jump to the real entry point of a function, and if it's not the normal flow where a function
                            // is called from the function selector.
                            if (
                                element.realFunctionEntry === jumpLocation.toJSNumber() &&
                                element.normalJumpToRealEntry !== opcode.pc
                            ) {
                                console.log('detected function jump for function ' + element.hash);
                                state.loglowlevel(
                                    'detected function jump for function ' + element.hash
                                );

                                // gather all input arguments from the stack
                                const input: any = [];
                                if (element.datatypes.length > 0) {
                                    element.datatypes.forEach(() => input.push(state.stack.pop()));
                                }

                                let name;
                                if (element.name) {
                                    name = element.name.replace(/\(.*\)/, '');
                                } else {
                                    name = element.hash.replace(/\(.*\)/, '');
                                }

                                const functionCall = new FUNCTIONCALL(name, input);
                                state.loglowlevel('new functioncall: ' + name);
                                state.loglowlevel(functionCall);

                                // pop return jump destination
                                state.stack.pop();

                                // push function return result
                                state.stack.push(functionCall);
                                jumped = true;
                            }
                        }
                    } else {
                        jumped = false;
                    }

                    if (!jumped) {
                        state.jumps[opcode.pc + ':' + jumpLocation.toJSNumber()] = true;
                        state.pc = jumpIndex;
                    }
                } else {
                    // console.log('JUMP Halting #3!');
                    state.halted = true;
                    state.instructions.push(new JUMP(jumpLocation, true));
                }
            } else {
                // console.log('JUMP Halting #4!');
                state.halted = true;
                state.instructions.push(new JUMP(jumpLocation));
            }
        }
    }
};
