import EVM from '../classes/evm.class';
import Opcode from '../interfaces/opcode.interface';
import * as BigNumber from '../../node_modules/big-integer';
import * as functionHashes from '../../data/functionHashes.json';
import stringify from '../utils/stringify';

const updateCallDataLoad = (item: any, types: any) => {
    for (const i in item) {
        if (item.hasOwnProperty(i)) {
            if (
                typeof item[i] === 'object' &&
                item[i].name === 'CALLDATALOAD' &&
                BigNumber.isInstance(item[i].location)
            ) {
                const argNumber = item[i].location
                    .subtract(4)
                    .divide(32)
                    .toString();
                item[i].type = types[argNumber];
            }
            if (typeof item[i] === 'object') {
                updateCallDataLoad(item[i], types);
            }
        }
    }
};

const findReturns = (item: any) => {
    const returns = [];
    for (const i in item) {
        if (item.hasOwnProperty(i)) {
            if (
                typeof item[i] === 'object' &&
                item[i].name === 'RETURN' &&
                item[i].items &&
                item[i].items.length > 0
            ) {
                returns.push(item[i].items);
            }
            if (typeof item[i] === 'object') {
                const deepReturns: any = findReturns(item[i]);
                if (deepReturns.length > 0) {
                    returns.push(...deepReturns);
                }
            }
        }
    }
    return returns;
};

export class TopLevelFunction {
    readonly name: string;
    readonly type?: string;
    readonly label: string;
    readonly hash: any;
    readonly gasUsed: number;
    readonly payable: boolean;
    readonly visibility: string;
    readonly constant: boolean;
    readonly items: any;
    readonly returns: any;

    constructor(items: any, hash: any, gasUsed: number) {
        this.name = 'Function';
        this.hash = hash;
        this.gasUsed = gasUsed;
        this.items = items;
        this.payable = true;
        this.visibility = 'public';
        this.constant = false;
        this.returns = [];
        if (this.hash in functionHashes) {
            this.label = (functionHashes as any)[this.hash];
        } else {
            this.label = this.hash + '()';
        }
        if (
            this.items.length > 0 &&
            this.items[0] instanceof REQUIRE &&
            this.items[0].condition.name === 'ISZERO' &&
            this.items[0].condition.item.name === 'CALLVALUE'
        ) {
            this.payable = false;
            this.items.shift();
        }
        if (this.items.length === 1 && this.items[0].name === 'RETURN') {
            this.constant = true;
        }
        if (this.hash in functionHashes) {
            const functionName = (functionHashes as any)[this.hash].split('(')[0];
            const argumentTypes = (functionHashes as any)[this.hash]
                .replace(functionName, '')
                .substr(1)
                .slice(0, -1)
                .split(',');
            if (
                argumentTypes.length > 1 ||
                (argumentTypes.length === 1 && argumentTypes[0] !== '')
            ) {
                this.items.forEach((item: any) => updateCallDataLoad(item, argumentTypes));
            }
        }
        const returns: any = [];
        this.items.forEach((item: any) => {
            const deepReturns = findReturns(item);
            if (deepReturns.length > 0) {
                returns.push(...deepReturns);
            }
        });
        if (
            returns.length > 0 &&
            returns.every(
                (returnItem: any) =>
                    returnItem.length === returns[0].length &&
                    returnItem.map((item: any) => item.type).join('') ===
                        returns[0].map((item: any) => item.type).join('')
            )
        ) {
            returns[0].forEach((item: any) => {
                if (BigNumber.isInstance(item)) {
                    this.returns.push('uint256');
                } else if (item.type) {
                    this.returns.push(item.type);
                } else {
                    this.returns.push('unknown');
                }
            });
        } else if (returns.length > 0) {
            this.returns.push('<unknown>');
        }
    }
}

export class Variable {
    readonly name: string;
    readonly label: string | false;
    readonly types: any;

    constructor(label: string | false, types: any) {
        this.name = 'Variable';
        this.label = label;
        this.types = types;
    }
}

export class REQUIRE {
    readonly name: string;
    readonly type?: string;
    readonly wrapped: boolean;
    readonly condition: any;
    readonly items: any;

    constructor(condition: any, items?: any) {
        this.name = 'REQUIRE';
        this.wrapped = true;
        this.condition = condition;
        this.items = items;
    }

    toString() {
        if (this.items) {
            return (
                'require(' +
                stringify(this.condition) +
                ', ' +
                this.items.map((item: any) => stringify(item)).join(', ') +
                ');'
            );
        } else {
            return 'require(' + stringify(this.condition) + ');';
        }
    }
}

export class JUMPI {
    readonly name: string;
    readonly type?: string;
    readonly wrapped: boolean;
    readonly condition: any;
    readonly location: any;
    readonly valid: boolean;
    readonly true?: any;
    readonly false?: any;
    readonly payable?: boolean;

    constructor(condition: any, location: any, ifTrue?: any, ifFalse?: any, skipped?: boolean) {
        this.name = 'JUMPI';
        this.wrapped = true;
        this.condition = condition;
        this.location = location;
        if (skipped) {
            this.valid = true;
        } else if (ifTrue && ifFalse) {
            this.valid = true;
            this.true = ifTrue;
            this.false = ifFalse;
            if (
                this.true.length >= 1 &&
                this.true[0] instanceof REQUIRE &&
                this.true[0].condition.name === 'ISZERO' &&
                this.true[0].condition.item.name === 'CALLVALUE'
            ) {
                this.payable = false;
                this.true.shift();
            } else {
                this.payable = true;
            }
        } else {
            this.valid = false;
        }
    }

    toString() {
        if (this.valid && this.true && this.false) {
            return stringify(this.condition);
        } else if (this.valid) {
            return 'if' + stringify(this.condition) + ' goto(' + stringify(this.location) + ');';
        } else {
            // console.log(this);
            return (
                'revert("Bad jump destination for JUMPI; location = 0x' +
                this.location.toString(16) +
                ' ");'
            );
        }
    }
}

export default (opcode: Opcode, state: EVM): void => {
    const jumpLocation = state.stack.pop();
    const jumpCondition = state.stack.pop();
    const opcodes = state.getOpcodes();
    // console.log(jumpLocation);
    // console.log(state.conditions);
    // console.log('-');
    if (!BigNumber.isInstance(jumpLocation)) {
        // console.log('JUMPI Halting #1!');
        state.halted = true;
        state.instructions.push(new JUMPI(jumpCondition, jumpLocation));
    } else {
        const jumpLocationData = opcodes.find((o: any) => o.pc === jumpLocation.toJSNumber());
        if (!jumpLocationData || jumpLocationData.name !== 'JUMPDEST') {
            //state.halted = true;
            //state.instructions.push(new JUMPI(jumpCondition, jumpLocation));
            state.instructions.push(new REQUIRE(jumpCondition));
        } else if (BigNumber.isInstance(jumpCondition)) {
            const jumpIndex = opcodes.indexOf(jumpLocationData);
            if (
                jumpIndex >= 0 &&
                !jumpCondition.equals(0) &&
                !(opcode.pc + ':' + jumpLocation.toJSNumber() in state.jumps)
            ) {
                state.jumps[opcode.pc + ':' + jumpLocation.toJSNumber()] = true;
                state.pc = jumpIndex;
            }
        } else if (
            !(opcode.pc + ':' + jumpLocation.toJSNumber() in state.jumps) &&
            jumpCondition.name === 'SIG'
        ) {
            const jumpIndex = opcodes.indexOf(jumpLocationData);
            if (jumpIndex >= 0) {
                const functionClone: any = state.clone();
                functionClone.pc = jumpIndex;

                const functionCloneTree = functionClone.parse();
                console.log('New top level function type #1: ' + jumpCondition.hash);

                state.functions[jumpCondition.hash] = new TopLevelFunction(
                    functionCloneTree,
                    jumpCondition.hash,
                    functionClone.gasUsed
                );
                if (
                    jumpCondition.hash in functionHashes &&
                    functionCloneTree.length === 1 &&
                    functionCloneTree[0].name === 'RETURN' &&
                    functionCloneTree[0].items.every((item: any) => item.name === 'MappingLoad')
                ) {
                    // the new function only returns something from the mapping
                    functionCloneTree[0].items.forEach((item: any) => {
                        const fullFunction = (functionHashes as any)[jumpCondition.hash];
                        state.mappings[item.location].name = fullFunction.split('(')[0];
                        if (
                            item.structlocation &&
                            !state.mappings[item.location].structs.includes(item.structlocation)
                        ) {
                            state.mappings[item.location].structs.push(item.structlocation);
                        }
                    });
                    delete state.functions[jumpCondition.hash];
                } else if (
                    jumpCondition.hash in functionHashes &&
                    state.functions[jumpCondition.hash].items.length === 1 &&
                    state.functions[jumpCondition.hash].items[0].name === 'RETURN' &&
                    state.functions[jumpCondition.hash].items[0].items.length === 1 &&
                    state.functions[jumpCondition.hash].items[0].items[0].name === 'SLOAD' &&
                    BigNumber.isInstance(
                        state.functions[jumpCondition.hash].items[0].items[0].location
                    )
                ) {
                    // the function is a public getter for a variable from storage
                    if (
                        !(
                            state.functions[jumpCondition.hash].items[0].items[0].location in
                            state.variables
                        )
                    ) {
                        // the function is just a public getter
                        const fullFunction = (functionHashes as any)[jumpCondition.hash];
                        state.variables[
                            state.functions[jumpCondition.hash].items[0].items[0].location
                        ] = new Variable(fullFunction.split('(')[0], []);
                        delete state.functions[jumpCondition.hash];
                    } else {
                        // the function is just a public getter
                        const fullFunction = (functionHashes as any)[jumpCondition.hash];
                        state.variables[
                            state.functions[jumpCondition.hash].items[0].items[0].location
                        ].label = fullFunction.split('(')[0];
                        delete state.functions[jumpCondition.hash];
                    }
                }
            }
        } else if (
            !(opcode.pc + ':' + jumpLocation.toJSNumber() in state.jumps) &&
            ((jumpCondition.name === 'LT' &&
                jumpCondition.left.name === 'CALLDATASIZE' &&
                BigNumber.isInstance(jumpCondition.right) &&
                jumpCondition.right.equals(4)) ||
                (jumpCondition.name === 'ISZERO' && jumpCondition.item.name === 'CALLDATASIZE'))
        ) {
            const jumpIndex = opcodes.indexOf(jumpLocationData);
            if (jumpIndex >= 0) {
                // console.log('JUMPI Halting #2!');
                state.halted = true;
                const trueClone: any = state.clone();
                trueClone.pc = jumpIndex;
                trueClone.conditions.push(jumpCondition);
                const trueCloneTree = trueClone.parse();
                const falseClone = state.clone();
                falseClone.pc = state.pc + 1;
                const falseCloneTree: any = falseClone.parse();
                if (
                    trueCloneTree.length > 0 &&
                    trueCloneTree.length === falseCloneTree.length &&
                    trueCloneTree[0].name !== 'REVERT' &&
                    trueCloneTree[0].name !== 'INVALID' &&
                    trueCloneTree.map((item: any) => stringify(item)).join('') ===
                        falseCloneTree.map((item: any) => stringify(item)).join('')
                ) {
                    console.log('New top level function type #2 = fallback function');
                    state.functions[''] = new TopLevelFunction(
                        trueCloneTree,
                        '',
                        trueCloneTree.gasUsed
                    );
                } else if (
                    trueCloneTree.length > 0 &&
                    trueCloneTree[0].name !== 'REVERT' &&
                    trueCloneTree[0].name !== 'INVALID'
                ) {
                    state.instructions.push(
                        new JUMPI(jumpCondition, jumpLocation, trueCloneTree, falseCloneTree)
                    );
                }
            } else {
                state.instructions.push(new JUMPI(jumpCondition, jumpLocation));
            }
        } else if (!(opcode.pc + ':' + jumpLocation.toJSNumber() in state.jumps)) {
            const jumpIndex = opcodes.indexOf(jumpLocationData);
            state.jumps[opcode.pc + ':' + jumpLocation.toJSNumber()] = true;
            if (jumpIndex >= 0) {
                // console.log('JUMPI Halting #3!');
                state.halted = true;
                const trueClone: any = state.clone();
                trueClone.pc = jumpIndex;
                trueClone.conditions.push(jumpCondition);
                const trueCloneTree = trueClone.parse();
                const falseClone = state.clone();
                falseClone.pc = state.pc + 1;
                const falseCloneTree: any = falseClone.parse();
                if (
                    (falseCloneTree.length === 1 &&
                        'name' in falseCloneTree[0] &&
                        (falseCloneTree[0].name === 'REVERT' &&
                            falseCloneTree[0].items &&
                            falseCloneTree[0].items.length === 0)) ||
                    falseCloneTree[0].name === 'INVALID'
                ) {
                    // the 'false' condition will do a revert
                    if (
                        jumpCondition.name === 'CALL' &&
                        BigNumber.isInstance(jumpCondition.memoryLength) &&
                        jumpCondition.memoryLength.isZero() &&
                        BigNumber.isInstance(jumpCondition.outputLength) &&
                        jumpCondition.outputLength.isZero() &&
                        jumpCondition.gas.name === 'MUL' &&
                        jumpCondition.gas.left.name === 'ISZERO' &&
                        BigNumber.isInstance(jumpCondition.gas.right) &&
                        jumpCondition.gas.right.equals(2300)
                    ) {
                        // the require is printed by the CALL instruction
                        jumpCondition.throwOnFail = true;
                        state.instructions.push(jumpCondition);
                        state.instructions.push(...trueCloneTree);
                    } else {
                        // but this case is a simple require(..)
                        state.instructions.push(new REQUIRE(jumpCondition));
                        state.instructions.push(...trueCloneTree);
                    }
                } else if (
                    falseCloneTree.length === 1 &&
                    'name' in falseCloneTree[0] &&
                    falseCloneTree[0].name === 'REVERT'
                ) {
                    state.instructions.push(new REQUIRE(jumpCondition, falseCloneTree[0].items));
                    state.instructions.push(...trueCloneTree);
                } else {
                    state.instructions.push(
                        new JUMPI(jumpCondition, jumpLocation, trueCloneTree, falseCloneTree)
                    );
                }
            } else {
                state.instructions.push(new JUMPI(jumpCondition, jumpLocation));
            }
        } else {
            state.instructions.push(new JUMPI(jumpCondition, jumpLocation, null, null, true));
        }
    }
};
