function MK85CPU(name) {
    this.name           = name;
    /* NOTE
     *  R6 is Stack Pointer,
     *  R7 is Instructioin Pointer,
     *  PSW is Processor Status Word.
     */
     
    this.regBuffer		= new ArrayBuffer(16);
    this.reg_u16		= new Uint16Array(this.regBuffer);
    this.reg_s16		= new Int16Array(this.regBuffer);
    this.reg_u8			= new Uint8Array(this.regBuffer);	// Should double the pointer value
    this.reg_s8			= new Int8Array(this.regBuffer);		// when accessing these

	this.padBuffer		= new ArrayBuffer(16);
    this.pad_u16		= new Uint16Array(this.padBuffer);
    this.pad_s16		= new Int16Array(this.padBuffer);
    this.pad_u8			= new Uint8Array(this.padBuffer);	// Should double the pointer value
    this.pad_s8			= new Int8Array(this.padBuffer);		// when accessing these

	this.ip				= new Uint16Array(2);	// "fake" instruction pointer used for 
												// offsetting inside an instruction while
												// reading multi-word ones
												// index 0 is absolute address
												// index 1 is offset from actual IP

    this.regSel         = 0x0000;   // HALT mode
    this.psw            = 0x0000;
    this.pc             = 0x0000;
    this.cpc            = 0x0000;
    this.cps            = 0x0000;
    this.sel			= 0x0000;
    this.opcode         = 0x0000;
	this.readCallback   = null;
    this.writeCallback  = null;

    this.debug = false;

    this._H = 0x0100;
    this._I = 0x0080;
    this._T = 0x0010;
    this._N = 0x0008;
    this._Z = 0x0004;
    this._V = 0x0002;
    this._C = 0x0001;
    
    this._RESET_VECTOR          = 0x0000;
    this._TRAP_BUS_ERROR        = 0x0004;
    this._TRAP_RESERVED_OPCODE  = 0x0008;
    this._TRAP_T_BIT            = 0x000C;
    this._TRAP_IO               = 0x0010;
    this._TRAP_ACLO             = 0x0014;
    this._TRAP_EMT              = 0x0018;
    this._TRAP_TRAP             = 0x001C;
    this._TRAP_EVNT             = 0x0020;
    this._HALT_TRAP             = 0x0078;
    this._TRAP_WIR              = 0x00A8;
};

MK85CPU.prototype.reset = function() {
	this.doVector(this._RESET_VECTOR);
};


MK85CPU.prototype.doVector = function(vectorAddr) {
	/* положить SP и IP на стек */
	var PS = this.reg_u16[6];
	var PC = this.reg_u16[7];
	this.reg_u16[6]-=2;
	this.access(this.reg_u16[6], PS, false);
	this.reg_u16[6]-=2;
	this.access(this.reg_u16[6], PC, false);
    /* Перейти на вектор */
    this.reg_u16[7] = this.access(0, null, false);
    this.psw = this.access(vectorAddr+2, null, false);
    if(this.debug)
    {
        console.log("go to vector (oct)", vectorAddr.toString(8),
                    "\nIP  = ", this.reg_u16[7].toString(16),
                    "\nPSW = ", this.psw.toString(16));
    };
};

MK85CPU.prototype.access = function(addr,writeVal,isByte) {
	if(!isByte && addr&1) { this.doVector(this._TRAP_BUS_ERROR); }; // TRAP 4, boundary error
    if(writeVal === null) {
        return this.readCallback(addr)|(isByte?0:this.readCallback(addr+1)<<8);
    } else {
        this.writeCallback(addr,writeVal&0xFF);
        if(!isByte) this.writeCallback(addr+1,(writeVal>>8)&0xFF);
        return null;
    };
};


MK85CPU.prototype.getLocation = function(addrMode, isByte) {
	var isReg   = (addrMode&0x38)?false:true;
	var regNum	= addrMode&0x07;
	var bitmask = isByte?0xff:0xffff;
	var immediate;
	var resultAddr;
	if(addrMode&0x38) {
		if((addrMode^0x30)&0x30) {
			// modes 1 through 6
			this.reg_u16[regNum]-=((addrMode&0x30)==0x20)?((isByte && (addrMode&0x08))?1:2):0;
			immediate = this.reg_u16[regNum];
			this.reg_u16[regNum]+=((addrMode&0x30)==0x10)?((isByte && (addrMode&0x08))?1:2):0;
		} else {
			// Index [deferred]
			immediate = (this.reg_u16[regNum] + 2 + this.ip[1] + this.access(this.reg_u16[7], null, false));
			this.reg_u16[7]+=2;
/*			this.ip[0]+=2;
			this.ip[1]+=2;*/
		};
		resultAddr = (addrMode&0x08)?this.access(immediate, null, false):immediate;
	} else {
		// register mode
		resultAddr = regNum;
	};
	return [isReg, resultAddr];
};

MK85CPU.prototype.readLocation = function(whereTheFuckAreMyPointersGoddamit, isByte) {
	if(whereTheFuckAreMyPointersGoddamit[0]) {
		return this.reg_u16[whereTheFuckAreMyPointersGoddamit[1]];
	} else {
		return this.access(whereTheFuckAreMyPointersGoddamit[1], null, isByte);
	};
};

MK85CPU.prototype.writeLocation = function(location, val, isByte) {
	if(location[0]) {
		if(isByte){ this.reg_u8[location[1]<<1] = val; } else { this.reg_u16[location[1]] = val };
	} else {
		this.access(location[1], val, isByte);
	};
};

MK85CPU.prototype.addressMode = function(addrMode,val,isByte) {
    /* warning ! increments IP if mode is 'index deferred' */
    var regIndex = addrMode&7;
    switch((addrMode>>3)&0x07)
    {
        /* register */
        case 0: 
        {
            if(val===null) {
                return this.reg_u16[regIndex];
            } else {
                this.reg_u16[regIndex] = val;
                return null;
            };
        };
        /* register deferred */
        case 1: return this.access(this.reg_u16[regIndex], val, isByte);
        /* autoincrement */
        case 2: 
        {
            var i = this.access(this.reg_u16[regIndex], val, isByte);
            this.reg_u16[regIndex] += isByte?1:2;
            return i;
        };
        /* autoincrement deferred */
        case 3:
        {
            var i = this.access(this.access(this.reg_u16[regIndex], null, false), val, isByte);
            this.reg_u16[regIndex] += 2;
            return i;
        };
        /* autodecrement */
        case 4:
        {
            this.reg_u16[regIndex] -= isByte?1:2;
            return this.access(this.reg_u16[regIndex], val, isByte);
        };
        /* autodecrement deferred */
        case 5:
        {
            this.reg_u16[regIndex] -= 2;
            return this.access(this.access(this.reg_u16[regIndex], null, false), val, isByte);
        };
        /* index */
        case 6:
        {
        	var j = (this.reg_u16[regIndex]+2+this.access(this.reg_u16[7], null, false));
            var i =  this.access(j , val, isByte);
/*            this.ip[0]+=2;
            this.ip[1]+=2;*/
            return i;
        };
        /* index deferred */
        case 7:
        {
            var i = this.access(this.access((this.reg_u16[regIndex]+2+this.access(this.reg_u16[7], null, false)), null, false), val, isByte);
/*            this.ip[0]+=2;
            this.ip[1]+=2;*/
            return i;
        };
    };
};


MK85CPU.prototype.getSrc = function(opcode) { return (opcode>>6)&0x3F; };
MK85CPU.prototype.getDst = function(opcode) { return (opcode)&0x3F; };

/* eye-candy */
MK85CPU.prototype.flipFlag = function(flag, cond) {
	this.psw = (cond)?(this.psw|=flag):(this.psw&=~(flag));
};

/* eye-candy */
MK85CPU.prototype.get3Bits = function(value, bitGroup) { return (value>>(3*bitGroup))&0x07; };

/* return BRanch instruction decision based on branch code
 * - true if branch
 * - false if skip
 */
MK85CPU.prototype.getBranchCondition = function(opcode)
{
	/* entire BR instruction logic is in there */
	var b15 = (opcode&0x8000)?true:false;
	var b10 = (opcode&0x0400)?true:false;
	var b9  = (opcode&0x0200)?true:false;
	var b8  = (opcode&0x0100)?true:false;
	/* unconditional "flag" */
	var uncond = (((opcode^0x8600)&0x8600)==0x8600);
	/* Z flag enabled */
	var Z = ((this.psw&this._Z)?true:false) && b9 && !(b10 && b15);
	/* C flag enabled */
	var C = ((this.psw&this._C)?true:false) && b9 && b15;
	/* V flag enabled */
	var V = ((this.psw&this._V)?true:false) && ((b10 && !b15) || (b15 && b10 && !b9));
	/* N flag enabled */
	var N = ((this.psw&this._N)?true:false) && (b10 || (b15 && !(b10 || b9)));
	/* compute actual value */
	var result = (uncond || (Z || (N != V) || C)) == b8;
	if(this.debug)
	{
		console.log("branch decision = ", result);
	};
	return result;
};

/* execute:
 *  Single-operand instruction
 *  Branch instruction (BRxx)
 *  Misc. instruction
 */
 
MK85CPU.prototype.executeX0XXXX = function(opcode)
{
	if(opcode&0x800)
	{
		// Single-ops
		// Misc.
	} else {
		if(opcode&0xFF00) {	// if high byte of the opcode is not 0, then it's a branch or misc.
			// Branches
			this.pad_u8[0] = opcode&0xff;		// get offset from opcode
			var offset = this.pad_s8[0] * 2;	// convert it using view and multiply it
			if (this.debug) {
				console.log("branch ", offset, (this.reg_u16[7]+offset).toString(16));
			};
			if(this.getBranchCondition(opcode))
			{
				this.reg_u16[7]+=offset;		// branch if branch condition if true
			};
		} else {	// misc. instructions otherwise
			switch(opcode&0xc0)
			{
				case 0x80:
				{
					if(opcode&0x20)
					{
						if(this.debug)
						{
							console.log((opcode&0x10)?"set":"reset",
										" flags", (opcode&0xf).toString(16));
						};
						var bitmask = (opcode&0x0f);
						this.psw = (opcode&0x10)?(this.psw|=bitmask):(this.psw&=~bitmask);
						return;
					}
				};
				case 0xc0:
				{
					/* SWAB */
					// get pointer to location
					console.log("derp1");
					var dst = this.getLocation(this.getDst(opcode), false);
					console.log("derp2", dst[1].toString(16));
					var val = this.readLocation(dst, false);
					console.log("derp3");
					// swap bytes
					var tmp = ((val&0xff)<<8)|((val>>8)&0xff);

					this.writeLocation(dst, tmp, false);
					this.flipFlag(this._V|this._C, false);
					this.flipFlag(this._N, (tmp&0x0080));
					this.flipFlag(this._Z, (tmp&0xff)==0);
				};
			};
		};
	};
	return;
};

MK85CPU.prototype.execInstruction = function() {
    /* Исполняет 1 машинную операцию */
    var opcode = this.access(this.reg_u16[7], null, false);
    this.ip[0] = this.reg_u16[7];
    this.reg_u16[7]+=2;
    /* увеличиваем счетчик инструкций */
/*    this.ip[0] = this.reg_u16[7] + 2;
    this.ip[1] = 2;*/
    if(this.debug) console.log("IP = ",this.reg_u16[7].toString(16),"opcode = ",opcode.toString(16));
	var bit15 = (opcode&0x8000)?true:false;

	var sect4 = this.get3Bits(opcode,4);
	
/*	try {
		if (sect4 == 0)
		{
			this.executeX0XXXX(opcode);
			break;
		}
	}
	catch(err) {
		// we'll use that to catch CPU exceptions
		// do nothing yet
	}
*/
	switch(this.get3Bits(opcode,4))
	{	
		case 0:
		{
			/* Single operand instructions,
			 * Branch instructions,
			 * miscellanious
			 */
			this.executeX0XXXX(opcode);
			break;
		};
		case 1:	// MOV[B]
		{
			var src = this.getLocation(this.getSrc(opcode), bit15);
			var dst = this.getLocation(this.getDst(opcode), bit15);
			console.log("MOV ", src[1].toString(16), dst[1].toString(16));
			//this.pad_u16[0] = this.readLocation(src, bit15);
			this.writeLocation(dst, this.readLocation(src, bit15), bit15);
			this.flipFlag(this._N, (src<0));
			this.flipFlag(this._Z, (src==0));
			this.flipFlag(this._V, false);
			break;
		};
		case 2: // CMP[B]
		{
			var src = this.addressMode(this.getSrc(opcode), null, opcode&0x8000);
			var dst = this.addressMode(this.getDst(opcode), null, opcode&0x8000);
			var result = src + (~dst) + 1;
			this.flipFlag(this._N, (result < 0));
			this.flipFlag(this._Z, (result == 0));
			this.flipFlag(this._C, (result <= 0xFFFF));
			this.flipFlag(this._V, ((dst^src)&(~(dst^result))&0x8000));	// ???
			break;
		};
		case 3: // BIT[B]
		{
			var src = this.addressMode(this.getSrc(opcode), null, opcode&0x8000);
			var dst = this.addressMode(this.getDst(opcode), null, opcode&0x8000);
			var result = src&dst;
			this.flipFlag(this._N, (opcode&0x8000)?(result&0x80):(result&0x8000));
			this.flipFlag(this._Z, (result == 0));
			this.flipFlag(this._V, false);
			break;
		};
		case 7:
		{
		    // Some additional two-operand instructions
		    // MUL, DIV, ASH, ASHC, XOR, (floating point things), (system instructions), SOB
		    switch((opcode>>9)&0x07) {
		        case 5:
		        {
		            /* несуществующие функции с плавающей запятой */
		            if(this.sel&0x80)
		            {
		                this.doVector(this._TRAP_RESERVED_OPCODE);
		            } else {
		                /* переход в режим HALT */
		                this.flipFlag(this._H, true);
		                this(this.sel&0xFF00)|0x08;
		            };
		            break;
		        };
		    };
		    break;
		};
//		case 4:
	};

};
MK85CPU.prototype.HALT = function(vector) {
	this.cpc = this.reg_u16[7];
	this.cps = this.reg_u16[6];
	if(this.psw&this._H) this.reg_u16[7] = 0x78|(this.sel&0xFF00);
};

