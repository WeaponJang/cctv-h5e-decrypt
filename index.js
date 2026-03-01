const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
//
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});
rl.question('请输入guid: ', async (guid) => {
    rl.close();
    guid = guid?.trim();
    try {
        const startTime = Date.now();
        await main(guid);
        await cleanupIntermediateFiles(guid);
        console.log('✅ 所有任务完成！');
        const totalTime = (Date.now() - startTime) / 1000;
        console.log(`\n 总耗时: ${totalTime.toFixed(2)}秒`);
        console.log('按任意键退出...');
        process.stdin.resume();
        process.stdin.on('data', () => process.exit(0));
    } catch (err) {
        console.error('💥 流程失败:', err.message || err);
        process.exit(1);
    }
});
async function main(guid) {
    const cdn = "dh5.cntv.qcloudcdn.com";
    const m3u8Url = `https://${cdn}/asp/h5e/hls/2000/0303000a/3/default/${guid}/2000.m3u8`;
    if (!m3u8Url) {
        console.error('❌ 未输入有效地址');
        process.exit(1);
    }
    const testDir = path.join(__dirname, guid);
    fs.mkdirSync(testDir, { recursive: true });
    const tsPrefix = path.join(testDir, '%04d.ts');
    const ffmpegPath = path.join(__dirname, 'ffmpeg.exe');
    const ffc = spawn(ffmpegPath, [
		'-hide_banner', '-stats',
		'-v', 'panic',
        '-i', `${m3u8Url}`,
        '-c', 'copy',
        '-f', 'segment',
        '-segment_time', '10',
        '-segment_format', 'mpegts',
        '-segment_list', guid + '/list.txt',
        '-segment_list_type', '4',
        '-y', `${tsPrefix}`
    ], {
        stdio: 'inherit',
        shell: false,
        cwd: __dirname
    });
    ffc.on('error', (err) => {
        if (err.code === 'ENOENT') {
            console.error('错误: 未找到 ffmpeg.exe,请确保已安装ffmpeg');
        } else {
            console.error('启动失败:', err.message);
        }
    });
    // 等待ffmpeg进程结束
    await new Promise((resolve, reject) => {
        ffc.on('close', (code) => {
            console.log(`子进程退出，代码: ${code}`);
            resolve();
        });
    });
    // 在main函数末尾调用解密函数
    await decryptTsFiles(guid);
}
// 修复后的解密功能核心函数
async function decryptTsFiles(guid) {
    const testDir = path.join(__dirname, guid);
    // 检查目录是否存在
    if (!fs.existsSync(testDir)) {
        throw new Error(`目标文件夹 ${testDir} 不存在`);
    }
    const finalOutput = path.join(testDir,"tmp.mp4");
	const args = [path.join(__dirname, 'main.mjs'), path.join(testDir, 'list.txt'), finalOutput];
	// 使用spawnSync同步执行解密命令
	const result = spawnSync(path.join(__dirname, 'node.exe'), args, {
		cwd: __dirname,
		stdio: 'inherit' // 继承输入输出
	});
	// 检查子进程执行结果
	if (result.status !== 0) {
		console.error(`❌ 解密失败 (退出码: ${result.status})`);
		if (result.error) {
			console.error('错误详情:', result.error.message);
		}
	} else {
		console.log(`✅ 输出文件: ${finalOutput}`);
	}
    console.log('\n🎉 所有.ts文件解密流程完成。');
}

// 新增：清理中间文件功能
async function cleanupIntermediateFiles(guid) {
    const testDir = path.join(__dirname, guid);
    if (!fs.existsSync(testDir)) {
        console.log('ℹ️  中间目录不存在，跳过清理步骤。');
        return;
    }
    console.log('\n🧹 开始清理中间文件...');
    let deletedTsCount = 0;
    // 删除所有.ts文件
    let tsFiles = fs.readdirSync(testDir).filter(file => file.endsWith('.ts'));
    tsFiles.push("list.txt");
    for (const file of tsFiles) {
        try {
            fs.unlinkSync(path.join(testDir, file));
            deletedTsCount++;
        } catch (err) {
            console.warn(`⚠️  无法删除文件 ${file}: ${err.message}`);
        }
    }
    console.log(`✅ 清理完成:`);
    console.log(`已删除中间文件: ${deletedTsCount} 个`);
    const finalOutput = path.join(testDir,"tmp.mp4");
    const outDir = path.join(__dirname,"video");
    fs.mkdirSync(outDir, { recursive: true });
    const dest = path.join(__dirname,"video",`${guid}.mp4`);
    fs.renameSync(finalOutput, dest);
    const remainingFiles = fs.readdirSync(testDir);
    if (remainingFiles.length === 0) {
        try {
            fs.rmdirSync(testDir);
            console.log(`🗂️  中间目录已为空，已删除目录`);
        } catch (err) {
            console.warn(`⚠️  无法删除中间目录: ${err.message}`);
        }
    } else {
        console.log(`ℹ️  中间目录中还有 ${remainingFiles.length} 个文件未删除`);
    }
    console.log(`🆗 最终输出文件为 -- ${dest}`);
}