const fs = require("fs");
const shell = require("shelljs");
const express = require("express");

const port = 3001;

const staticDir = "static/";
const tempDirRoot = "temp/";
const outputDir = "output/";
const httpOutputURL = "output/";

// Checklist of valid formats and scales, to verify form values are correct
const validFormats = ["SVG", "PNG", "JPG"];
const validScales = [
  "10%",
  "25%",
  "50%",
  "75%",
  "100%",
  "125%",
  "150%",
  "200%",
  "500%",
  "1000%",
];
// Percentage scales mapped to floating point values used in arguments
const validScalesInternal = [
  "0.1",
  "0.25",
  "0.5",
  "0.75",
  "1.0",
  "1.25",
  "1.5",
  "2.0",
  "5.0",
  "10.0",
];

// Command to compile .tex file to .dvi file. Timeout kills LaTeX after 5 seconds if held up
const latexCMD =
  "timeout 5 latex -interaction nonstopmode -halt-on-error --no-shell-escape equation.tex";

// Command to convert .dvi to .svg file
const dvisvgmCMD =
  "dvisvgm --no-fonts --scale=OUTPUT_SCALE --exact equation.dvi";

const dockerImageName = "blang/latex:ubuntu"; // https://github.com/blang/latex-docker

// Command to run the above commands in a new Docker container (with LaTeX preinstalled)
const dockerCMD = `cd TEMP_DIR_NAME && exec docker run --rm -i --user="$(id -u):$(id -g)" --net=none -v "$PWD":/data "${dockerImageName}" /bin/sh -c "${latexCMD} && ${dvisvgmCMD}"`;

// Commands to convert .svg to .png/.jpg and compress
const svgToImageCMD = "svgexport SVG_FILE_NAME OUT_FILE_NAME";
const imageMinCMD = "imagemin IN_FILE_NAME > OUT_FILE_NAME";

const fontSize = 12;

// LaTeX document template
const preamble = `
\\usepackage{amsmath}
\\usepackage{amssymb}
\\usepackage{amsfonts}
\\usepackage[utf8]{inputenc}
`;

const documentTemplate = `
\\documentclass[${fontSize}pt]{article}
${preamble}
\\thispagestyle{empty}
\\begin{document}
\\begin{align*}
EQUATION
\\end{align*}
\\end{document}`;

// Create temp and output directories on first run
if (!fs.existsSync(tempDirRoot)) {
  fs.mkdirSync(tempDirRoot);
}
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}

const app = express();

const bodyParser = require("body-parser");
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Allow static html files and output files to be accessible
app.use("/", express.static(staticDir));
app.use("/output", express.static(outputDir));

// POST call for LaTeX to image conversion. Convert and return image URL or error message
app.post("/convert", function (req, res) {
  // Ensure valid inputs
  if (req.body.latexInput) {
    if (validScales.includes(req.body.outputScale)) {
      if (validFormats.includes(req.body.outputFormat)) {
        const id = generateID(); // Generate unique ID for filename

        let eqnInput = req.body.latexInput.trim();
        if (/\\\\(?!$)/.test(eqnInput) && !eqnInput.includes("&")) {
          // if any "\\" not at EOF, unless intentionally aligned with &
          eqnInput = "&" + eqnInput.replace(/\\\\(?!$)/g, "\\\\&"); // replace any "\\" not at EOF with "\\&", to enforce left alignment
        }

        shell.mkdir(`${tempDirRoot}${id}`);

        const document = documentTemplate.replace("EQUATION", eqnInput);
        fs.writeFileSync(`${tempDirRoot}${id}/equation.tex`, document); // Write generated .tex file

        let result = {};

        let finalDockerCMD = dockerCMD.replace(
          "TEMP_DIR_NAME",
          `${tempDirRoot}${id}`
        );
        finalDockerCMD = finalDockerCMD.replace(
          "OUTPUT_SCALE",
          validScalesInternal[validScales.indexOf(req.body.outputScale)]
        );

        const fileFormat = req.body.outputFormat.toLowerCase();

        // Asynchronously compile and render the LaTeX to an image
        shell.exec(finalDockerCMD, { async: true }, function () {
          if (fs.existsSync(`${tempDirRoot}${id}/equation.svg`)) {
            if (fileFormat === "svg") {
              // Converting to SVG, no further processing required
              shell.cp(
                `${tempDirRoot}${id}/equation.svg`,
                `${outputDir}img-${id}.svg`
              );
              result.imageURL = `${httpOutputURL}img-${id}.svg`;
            } else {
              // Convert svg to png/jpg
              let finalSvgToImageCMD = svgToImageCMD.replace(
                "SVG_FILE_NAME",
                `${tempDirRoot}${id}/equation.svg`
              );
              finalSvgToImageCMD = finalSvgToImageCMD.replace(
                "OUT_FILE_NAME",
                `${tempDirRoot}${id}/equation.${fileFormat}`
              );
              if (fileFormat === "jpg") {
                // Add a white background for jpg images
                finalSvgToImageCMD += ' "svg {background: white}"';
              }
              shell.exec(finalSvgToImageCMD);

              // Ensure conversion was successful; eg. fails if `svgexport` or `imagemin` is not installed
              if (fs.existsSync(`${tempDirRoot}${id}/equation.${fileFormat}`)) {
                // Compress the resultant image
                let finalImageMinCMD = imageMinCMD.replace(
                  "IN_FILE_NAME",
                  `${tempDirRoot}${id}/equation.${fileFormat}`
                );
                finalImageMinCMD = finalImageMinCMD.replace(
                  "OUT_FILE_NAME",
                  `${tempDirRoot}${id}/equation_compressed.${fileFormat}`
                );
                shell.exec(finalImageMinCMD);

                // Final image
                shell.cp(
                  `${tempDirRoot}${id}/equation_compressed.${fileFormat}`,
                  `${outputDir}img-${id}.${fileFormat}`
                );

                result.imageURL = `${httpOutputURL}img-${id}.${fileFormat}`;
              } else {
                result.error = `Error converting SVG file to ${fileFormat.toUpperCase()} image.`;
              }
            }
          } else {
            result.error =
              "Error converting LaTeX to image. Please ensure the input is valid.";
          }

          shell.rm("-r", `${tempDirRoot}${id}`); // Delete temporary files for this conversion

          res.end(JSON.stringify(result));
        });
      } else {
        res.end(JSON.stringify({ error: "Invalid image format" }));
      }
    } else {
      res.end(JSON.stringify({ error: "Invalid scale" }));
    }
  } else {
    res.end(JSON.stringify({ error: "No LaTeX input provided" }));
  }
});

// Start the server
app.listen(port, function () {
  console.log(`Latex2image listening on port ${port}`);
});

function generateID() {
  // Generate a random 16-char hexadecimal ID
  let output = "";
  for (let i = 0; i < 16; i++) {
    output += "0123456789abcdef".charAt(Math.floor(Math.random() * 16));
  }
  return output;
}
